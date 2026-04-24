# TsumeSight — Architecture

Liberty-reading trainer for Go. User plays through an SGF sequence from
memory, then marks each group's liberty count; app scores accuracy +
speed and awards 1–5 stars / medal / trophy.

Stack: Preact + Vite + @sabaki/go-board + @sabaki/sgf + @sabaki/shudan.

## V4: Event-Sourced Session

The quiz session is **only** an append-only event log plus the SGF.
Every other value — phase, marks, engine state, display maps, score —
derives from folding events through a pure reducer. No parallel
representation of the session exists; it cannot drift.

### Data flow

```
events[] ──step──▶ state ──derive──▶ view ──display──▶ maps ──▶ Goban
events[] ──sideEffectsFor──▶ Effect[] ──▶ {sound, onProgress, addReplay, ...}
```

Every arrow is a pure function. Each is testable in isolation.

### Events

```
{kind: 'advance' | 'rewind' | 'setMark' | 'submit', ...fields, t}
```

`t` is a relative timestamp (ms from first event). Event shape is
versioned at `EVENT_SCHEMA_VERSION = 2` in `fixture-schema.js`.

### State (produced by `session.init`, advanced by `session.step`)

```
{
  sgf,              // input SGF string
  maxSubmits,
  maxQuestions,
  engine,           // QuizEngine instance; mutated in place by step
  totalMoves,
  cursor,           // 0..N+1; showing phase at cursor ≤ N
  hasExercise,      // set when activate-exercise advance runs
  marks,            // Map<"x,y", {value, color}>
  submitCount,
  submitResults,    // Array of per-submit per-group statuses
  events,           // append-only log (source of truth)
  startTime,        // performance.now() at first event
}
```

Engine still lives on state (pragmatic compromise — see
`Cleanups.md` § V4 completion).

### Phase selector

```
cursor ≤ totalMoves           → 'showing'
cursor > totalMoves, finalized → 'finished'
cursor > totalMoves, !finalized, hasExercise → 'exercise'
cursor > totalMoves, !hasExercise → 'finished'
```

`finalized` = any correct submit, or `submitCount ≥ maxSubmits`.

## Module layout

```
src/
  main.jsx              Bootstrap: PWA env redirect, kv load, render <App>
  app.jsx               Route: <Library> or <Quiz> based on active sgf
  error-boundary.jsx    <ErrorBoundary> around Quiz subtree

  library.jsx           File browser: loads sgfs, cwd, dir stats, keyboard
  library-menu.jsx      <LibraryMenu> hamburger + uploads + env + version
  library-tile.jsx      <DirTile>, <DirHeaderTile>, <FileTile>
  usePwaInstall.js      beforeinstallprompt wiring → {canInstall, install}

  quiz.jsx              Orchestrator: events state, dispatch, layout, keyboard
  quiz-board.jsx        <QuizBoard> + pickBoardLayout; renders Goban
  quiz-wheel.jsx        <RadialMenu> + useWheel hook (pointer gesture)
  quiz-finish.jsx       <FinishPopup> + <StatsBar>

  session.js            init, step (reducer), pure selectors, MISSED sentinel
  derive.js             derive(state) → view
  display.js            buildMaps, rotateMaps, orderGroupsByDisplay
  effects.js            sideEffectsFor, computeFinalizeData
  navigation.js         siblings, stepSibling, nextUnsolved, toSelection
  importer.js           importFiles, importFolder, importUrl

  engine.js             QuizEngine (Go/liberty domain; mutable class)
  scoring.js            computeStars, computeParScore, etc. + <StarsDisplay>
                        (rules + formulas: see docs/SCORING.md)
  sounds.js             playStoneClick, playMark, playCorrect, etc.
  sgf-utils.js          parseSgf, decodeSgf, computeRange
  archive.js            isArchive, extractSgfs (.zip / .tar / .tar.gz)
  db.js                 IndexedDB wrapper + kv cache

  config.js             Compile-time constants (cup timings, flash, etc.)
  version.js            Git SHA / commit date surfaced in hamburger menu
  fixture-schema.js     SCHEMA_VERSION, EVENT_SCHEMA_VERSION constants
  fixture-migrate.js    Migration chain (stub for future bumps)
  test-setup.js         fake-indexeddb polyfill for vitest env
```

## Quiz engine (`engine.js`)

Homegrown Go/liberty domain. Deterministic: seeded from `hashString(sgf)`
via `mulberry32`. Consumed by `session.js` via `state.engine`.

Key state:
- `trueBoard` — @sabaki/go-board Board, the real game state (with captures).
- `baseSignMap` — mutable 2D copy of the initial position.
- `invisibleStones` — Map of stones on true board but hidden on display.
- `libertyExercise.groups` — per-group `{vertex, chainKeys, libCount, changed}`.
- `boardRange` — auto-computed bounding box for cropped display.

Key methods:
- `advance()` — play next move, detect captures, track as invisible.
- `activateQuestions()` — called at end of sequence; flips to exercise phase.
- `checkLibertyExercise(marks)` — grade user marks; returns per-group statuses.

The engine is the one "homegrown" module still at the core of the data
flow. V4 keeps it at arm's length via `derive`.

## Persistence (`db.js`)

Two stores:
- **`sgfs`** (IndexedDB object store) — uploaded SGF records with metadata.
- **`kv`** (IndexedDB + in-memory cache) — keyed blobs for settings and replays.

Eager-persisted live session log (P2.5):
```
kv('session:<sgfId>:<startTime>')  = JSON.stringify(events)
```
Never cleaned up; preserved as raw history.

Enriched finalized replay (P0.1, v:3 schema):
```
kv('replay:<sgfId>:<finishDate>') = {
  v: 3,
  events,
  config: {maxSubmits, maxQuestions},
  viewport: {w, h, rotated},
  goldens: {scoreEntry, finalMarks, submitResults, changedGroupsVertices}
}
```
The fixture converter (`scripts/zip-to-fixtures.mjs`) promotes v:3
records directly into test fixtures.

## Display pipeline

`derive.js` wraps state + engine into a view. `display.js` turns view +
state + UI flags into the four arrays Shudan's `<Goban>` expects:

- `signMap` — stones (1 black, -1 white, 0 empty).
- `markerMap` — labels (move number, liberty value, "?" for missed).
- `ghostStoneMap` — always empty; Shudan API compat.
- `paintMap` — 1 green / -1 red for eval feedback.

`rotateMaps` transposes all four at once if the board is displayed
rotated (chosen by `pickBoardLayout` based on viewport aspect).
`orderGroupsByDisplay` gives the finish popup its left-to-right
top-to-bottom score order.

## Effects

`effects.js:sideEffectsFor(next, event)` is pure: returns an array of
effect descriptors (`{kind:'sound/correct'}`, `{kind:'onProgress', ...}`,
etc.) based on event kind + post-state.

`effects.js:computeFinalizeData(state, ctx)` is pure: computes
`scoreEntry`, `replayPayload`, and `popupData` at finalize time. `ctx`
carries `loadTimeMs`, `rotated`, `viewport`, `sgfId`, `config`.

`quiz.jsx` runs a tiny `runEffect` switch translating descriptors into
real actions (playStoneClick, setWrongFlash, onProgress, etc.). The
finalize useEffect calls `computeFinalizeData` then fans out into
playComplete / addReplay / onSolved / setFinishPopup.

## Quiz UI flow

User taps board intersection:
1. **Showing phase:** advance event dispatched; engine advances one move.
2. **Exercise phase:** `useWheel` pointer-down. Fast flick commits mark
   immediately (`setMark` event, value from wheel zone). Slow press
   reveals `<RadialMenu>`; release commits.

Keyboard shortcuts (on `<Quiz>`):
- Space / Enter → dispatchSubmit or dispatchAdvance depending on phase.
- R → rewind (or restart in finished phase).
- Escape → confirm-exit flow.
- Enter in finished phase → onNextUnsolved.

## Navigation

`navigation.js` holds all "what puzzle comes next" logic:
- `siblings(sgfs, cwd)` — sort by uploadedAt + filename.
- `stepSibling(list, currentId, delta)` — cyclic prev/next.
- `nextUnsolved(list, currentId, scoreLookup)` — first unsolved →
  first imperfect → least-recently-practiced. Returns `{sgf, reason}`.
- `toSelection(s)` — builds the `{id, content, path, filename, solved}`
  payload onSelect handlers expect.

`scoreLookup: (id) => {bestAccuracy, latestDate}` keeps the core decoupled
from db.

## Testing strategy

**Layer A** (`src/fixtures.test.js`) — primary regression safety net.
For each `fixtures/*.events.json`:

1. `init(sgf, config)` + fold events via `step`.
2. Snapshot derived view at every event step into
   `fixtures/__snapshots__/<name>.snap.json`.
3. Cross-check goldens: score, final marks, submit results, changed groups.

Corpus: 9 user-recorded (capture-race) + 9 canonical (generated by
`scripts/gen-canonical-fixtures.mjs`). Any drift in session/engine
semantics shows up as snapshot diff at the exact failing step.

Module-level tests: `session.test.js` (50 cases), `engine.test.js`
(600+ cases), `scoring.test.js`, `display.test.js`, `effects.test.js`,
`navigation.test.js`, `sgf-utils.test.js`, `archive.test.js`,
`sounds.test.js`, `render.test.jsx`, `db.test.js`.

Layer B (DOM snapshots at phase boundaries) and Layer C
(pointer/keyboard translation) were scoped in the refactor plan but
not shipped — see `Cleanups.md`.

## Known behavior (as of 2026-04-18 refactor)

- Browser history not integrated — OS back exits the PWA; Escape
  exits a puzzle.
- Reopening an unsolved puzzle **always starts fresh**; abandoned
  sessions persist in kv as raw history but aren't resumed into the UI.
- Solved-puzzle review folds the latest stored replay.
- Abandoned `session:*` kv entries are never cleaned up.

## Conventions

- All user-visible strings (tooltips, labels, ARIA) stay in sync with
  behavior. Tooltips include the keyboard shortcut in parentheses when
  one exists.
- Pure selectors on state rather than class getters.
- Event shape frozen at v:2; bumps require a migrator entry in
  `fixture-migrate.js`.
- Tests green at every commit; structural and behavioral changes in
  separate commits.
