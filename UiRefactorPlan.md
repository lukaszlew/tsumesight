# UI Refactor Plan

Distilled from the design conversation of 2026-04-18. Target: maintainability and debuggability over all other lenses, with small-surface APIs as the operating principle ("code is a graph, cut it in narrow understandable testable places").

**Status:** Shipped 2026-04-18. All 17 phases (P0.1 through P8) committed on `dev`. 266 tests passing. See the Known Behavior Changes log below for user-visible shifts.

---

## Glossary

Defined here once; referenced throughout without re-definition.

- **V4 (event-sourced session)** — the chosen session architecture. A quiz session is *only* an append-only array of events plus the SGF. Every other value (phase, marks, engine state, display maps, score) is derived by folding events through a pure reducer and passing the result through pure derivations. No parallel representations, no mutable class, no state-event divergence possible.

- **event** — one atomic user action: `{kind:'advance'|'rewind'|'setMark'|'submit', ...fields, t}`. `t` is a relative timestamp in ms from the session's first event. Today's shape is `eventSchemaVersion: 2`.

- **finalize** — the moment the session transitions into `phase: 'finished'`. Triggered when either all groups are correct OR `maxSubmits` has been reached. Computes the final score entry, plays the completion sound, shows the finish popup, and writes the enriched replay record.

- **fixture** — a saved test case. One JSON file containing: SGF content, event log, config at record time, and "goldens." Used by the snapshot test suite to exercise end-to-end behavior deterministically.

- **goldens** — the "expected outputs" recorded inside a fixture (final score, final marks, submit results, changed-groups list). Snapshot tests cross-check the current code's replay against these values.

- **schemaVersion** — version tag on the **fixture file** shape itself. Bumps when we change *what's stored in a fixture*.

- **eventSchemaVersion** — version tag on the **event stream** shape inside a fixture. Separate from `schemaVersion` because the fixture file can stay stable while events inside evolve.

- **Layer A / B / C tests** — the three testing layers.
  - *A* = pure data. Fold events through the reducer, assert derived view + goldens. Fastest, broadest. Microseconds.
  - *B* = rendered DOM snapshot at key checkpoints. Catches class-name and JSX bugs. Seconds total.
  - *C* = pointer/keyboard → event translation. 5–10 focused tests at the UI edge. Milliseconds.

- **Pn** — sequential commits. Order matters; each leaves tests green.

---

## Architecture (target state)

```
src/
  session.js          init(sgf, config), step(state, evt) → state   [pure]
  derive.js           derive(state, sgf, config) → view              [pure]
  display.js          buildMaps(view, opts) → maps;
                      rotateMaps(maps) → maps;
                      orderGroupsByDisplay(groups, rotated) → idx    [pure]
  effects.js          sideEffectsFor(prev, next, evt, ctx) → Effect[] [pure]
  navigation.js       siblings, nextUnsolved, step                   [pure]
  importer.js         file/folder/URL/archive → sgf records          [mostly pure]
  fixture-schema.js   schemaVersion, eventSchemaVersion constants
  fixture-migrate.js  migrate(fixture) → latest                      [pure]

  quiz.jsx            orchestrator (~150 lines)
  quiz-board.jsx      receives display maps + handlers → Goban
  quiz-wheel.jsx      radial menu + pointer hooks
  quiz-finish.jsx     finish popup + stats table
  library.jsx         browser, uses importer + navigation
  app.jsx             ~40 lines: compose hooks, pick route
  main.jsx            unchanged
```

Persistence shape:

- `kv('session:<sgfId>:<startTime>')` — live event log, appended on every `dispatch(event)`. Retained forever as raw history.
- `kv('replay:<sgfId>:<finishDate>')` — `v:3` enriched record written on finalize: `{v:3, events, config, viewport, goldens}`. Matches fixture schema 1:1.
- `kv('scores:<sgfId>')` — unchanged (array of score entries).

Data-flow invariant:

```
events → step → state → derive → view → display → maps → Goban
events → sideEffectsFor → Effect[] → {sound, onProgress, onSolved, addReplay}
```

Every arrow is a pure function. Everything testable in isolation.

---

## Testing Strategy

**Fixtures drive everything.** Every bug is reproducible by `events.reduce(step, init(sgf, config))`. Regressions surface as snapshot diffs or golden mismatches.

- **Layer A** (primary): for every fixture, fold events, check derived view at each step, cross-check goldens.
- **Layer B** (secondary): one DOM snapshot per fixture at each phase boundary. Catches rendering bugs A can't.
- **Layer C** (targeted): 5–10 tests for pointer-down / keydown → event mapping.
- Existing tests (`engine.test.js`, `scoring.test.js`, `archive.test.js`, `sgf-utils.test.js`, `session.test.js`, `sounds.test.js`, `quiz-layout.test.js`, `render.test.jsx`) stay; they cover leaf modules and don't overlap with A.

**Fixture sources:**
1. Existing `v:2` verbose replays in user's export zip (11 replays, 7 SGFs, back-filled via converter — scoreEntry golden only).
2. Fresh play sessions today (10–20 puzzles on a varied mix). Auto-written to `v:3` by the new `addReplay`, full goldens.
3. Legacy `v:2` compact + `v:undefined` replays: deferred indefinitely. Decoder only if fixture coverage proves insufficient.

**Schema discipline:**

- `schemaVersion` (fixture) and `eventSchemaVersion` (events) are independent, both versioned.
- On any bump, a migration function is added to `fixture-migrate.js`. Fixtures stay readable forever.

---

## Phased Plan

Each phase = one or more commits. Tests green at the end of each commit. Never bundle structural and behavioral changes in the same commit.

### P0 — Fixture infrastructure

**Goal:** Lock current behavior into a snapshot corpus before any refactor.

**Rationale:** Without a safety net drawn from real sessions, later phases can silently change behavior. P0 costs a few hours; it pays for the entire refactor.

**Split into 3 commits:**

#### P0.1 — Schema + `addReplay` bump

- **New:** `src/fixture-schema.js` — exports `SCHEMA_VERSION = 1`, `EVENT_SCHEMA_VERSION = 2`, plus typed shape constants (as JSDoc comments, no runtime types needed).
- **New:** `src/fixture-migrate.js` — stub with `migrate(fixture) → fixture` (identity for v1). Gets a real entry on the first schema bump.
- **Modify:** `src/db.js:addReplay` — take `{events, config, viewport, goldens}` instead of just `events`. Write `{v:3, events, config, viewport, goldens}`. Keep the old `v:2` write path as a fallback for callers that only have events (back-compat during P1).
- **Modify:** `src/db.js:getReplay` — normalize on read. Return `{events}` for v:2 (current behavior). Return `{events, config, viewport, goldens}` for v:3. Callers that only need `events` keep working by destructuring.
- **Modify:** `src/quiz.jsx` — update the one `addReplay` call site (`quiz.jsx:218`) to pass the enriched payload. `config = {maxSubmits, maxQuestions: maxQ}`, `viewport = {w: window.innerWidth, h: window.innerHeight, rotated}`, `goldens = {scoreEntry, finalMarks, submitResults, changedGroupsVertices, phaseTransitions}`. `finalMarks` serialized as `[{key, value, color}, ...]`; `phaseTransitions` tracked by a simple counter during `checkFinished` or derived from the event log after the fact.
- **Tests:** one unit test asserting `addReplay + getReplay` round-trips the full v:3 payload.
- **Exit:** every finalize from this commit onward writes a v:3 enriched record to kv. The next puzzle you play locally generates the first full-golden fixture source.

#### P0.2 — Converter script

- **New:** `scripts/zip-to-fixtures.mjs` (node). Usage: `node scripts/zip-to-fixtures.mjs <path-to-export.zip> [--out fixtures/]`.
  - Uses `jszip` (already a project dep).
  - Reads `tsumesight.json`, walks `kv` for `replay:*:*` keys.
  - For each `v:3` key: emit full `fixture-schema.js` v1 with all goldens.
  - For each `v:2` verbose key (has `event.kind`): emit fixture with only `scoreEntry` golden pulled from matching `scores:*` entry by `date`. Mark `config`, `viewport`, other goldens as `null` + include a note field.
  - Skip `v:2` compact (has `event.a` / `event.ex` but no `event.kind`) and `v:undefined`. Log one line per skipped.
  - Writes to `fixtures/<sanitized-filename>--<date>.events.json`.
- **New:** `fixtures/` directory. `fixtures/__snapshots__/` for vitest.
- **Modify:** `.gitignore` — ensure `tmp/` stays ignored (it is); do NOT ignore `fixtures/`.
- **Play session:** after this commit merges, play 10–20 puzzles on a varied mix (see "Fixture coverage target" below), export, run converter. Fixtures accumulate under `fixtures/`.

**Fixture coverage target (~20–25 total):**
- Small board (≤9×9) and large board (19×19).
- Capture-race, semeai, life-and-death, intermediate.
- All-correct first submit.
- Wrong-then-correct second submit.
- Force-committed (2 wrong submits, max-submits reached).
- Rewind mid-exercise then resubmit.
- Multi-group exercises (2+ changed groups).
- Locked-vertex puzzle (pre-marked groups present).
- Missed group (`?`-mark outcome).

#### P0.3 — Layer A harness

- **New:** `src/__tests__/fixtures.test.js` (or `src/fixtures.test.js`) — loads every `fixtures/*.events.json`, folds events through **current `QuizSession`**, snapshots derived view at each event, asserts goldens.
- **Derived view snapshot shape** per step: `{cursor, phase, hasExercise, submitCount, marks: sortedEntries, submitResults}`. Skip engine internals — too churny.
- **Goldens assertions:** if fixture has non-null `goldens.scoreEntry`, compare against `session.checkFinished()`-equivalent computation; if null (back-filled from v:2 verbose), skip.
- **Snapshot files:** `fixtures/__snapshots__/*.json` — one per fixture, committed to repo.
- **Exit:** `npm test` runs Layer A over the ~20-fixture corpus, all green.

---

### P1 — Extract pure `step` and `init`

**Goal:** Pure functions exist next to `QuizSession`, with identical semantics. Class stays as thin wrapper during this phase.

- **Modify:** `src/session.js`:
  - New top-level `export function init(sgf, config)` returns initial state object `{cursor:0, hasExercise:false, marks:new Map(), submitCount:0, submitResults:[], events:[], startTime:null}` plus a fresh `QuizEngine` for derive-layer use (engine still stateful internally; reducer just stores state fields).
  - New top-level `export function step(state, event)` returns new state. Pure. Same switch as current `applyEvent`, but operates on a destructured `state` and returns a new object.
  - **Engine handling is the interesting decision.** Options:
    - **(a)** Keep `engine` as a field on state. `step` mutates the engine in-place and returns a new state object wrapping the same engine. Not strictly pure but "effectively pure" for the reducer's purpose (engine is owned by this state tree, never shared). Simplest path; matches current semantics exactly.
    - **(b)** Rebuild engine from scratch inside `derive.js`; engine not in state. More pure; but P1's goal is minimal-change. Defer to P3.
  - **Chosen: (a).** Engine is part of state during P1. Gets moved to derive-time rebuild in P3.
- **Modify:** `QuizSession.applyEvent(evt)` becomes `this._state = step(this._state, evt); Object.assign(this, this._state)`. Exposes same fields for existing tests. Engine unchanged.
- **Tests:** existing `session.test.js` all green. Layer A snapshots all green (proves extraction preserved semantics bit-for-bit).

**Risk:** any accidental semantic drift in the extraction will show up immediately in Layer A snapshots. If a snapshot diffs, stop and investigate — don't `vitest -u`.

---

### P2 — Quiz uses `useReducer`; delete `QuizSession` class

**Goal:** Events are the only session state; React owns the array.

- **Modify:** `src/quiz.jsx`:
  - Replace `sessionRef` + `forceRender` with `let [events, setEvents] = useState(() => loadInitialEvents(sgfId, wasSolved, restored))` plus `let state = useMemo(() => events.reduce(step, init(sgf, config)), [events, sgf, config])`.
  - `loadInitialEvents(sgfId, wasSolved, restored)` returns the latest replay's events if `wasSolved && restored`, else `[]`. Current logic from `quiz.jsx:146-165` collapses to this single call.
  - `dispatch(evt) = setEvents(e => [...e, {...evt, t: evt.t ?? (e.length === 0 ? 0 : performance.now() - startTime)}])`.
  - Replace every `session.applyEvent(evt)` with `dispatch(evt)`. Replace every `session.XYZ` read with `state.XYZ` or `view.XYZ` (view from derive; comes in P3).
  - Remove `selectCount` remount hack from `app.jsx`. `key={active.id}` alone is enough because `events` resets via `useState(() => ...)` initializer on remount.
- **Delete:** `QuizSession` class (session.js). Delete `restoreFromEventLog` (quiz.jsx:116-118).
- **Keep:** `session.js` exports only `{init, step, pointsByGroup}`.
- **Tests:**
  - Rewrite `session.test.js` against `step(state, evt)` directly. Every test case in the file maps 1:1: `let s = new QuizSession(sgf)` → `let s = init(sgf, config)`; `s.applyEvent(evt)` → `s = step(s, evt)`. Assertions work unchanged on the `state` object.
  - Layer A harness updated to use `step`/`init` instead of `QuizSession`.
  - Double-check before deleting any test — the user's rule. Nothing obviously deletable in session.test.js; every test should port.

**Risk:** remount timing around `useState(() => ...)` initializer. If events don't reset properly when opening a different puzzle, the symptoms are loud (wrong board). Easy to catch manually.

---

### P2.5 — Eager event persistence

**Goal:** Crash resistance + raw-history preservation.

- **Modify:** `src/quiz.jsx`:
  - `let startTimeRef = useRef(null)` — set on first event.
  - `useEffect(() => { if (events.length > 0) kvSet('session:' + sgfId + ':' + startTimeRef.current, JSON.stringify(events)) }, [events])`.
- **Behavior:**
  - On open of an unsolved puzzle: events = []. Fresh start. Previous `session:<sgfId>:<oldStartTime>` keys left in place as raw history.
  - On open of a solved puzzle: events = latest replay (unchanged from P2).
  - On finalize: `addReplay` writes `replay:<sgfId>:<finishDate>`. The `session:<sgfId>:<startTime>` key is **not** removed. Cleanup deferred indefinitely (per user decision: "why clean at all?").
- **Tests:** one integration-style test that (a) opens a quiz, (b) dispatches 3 events, (c) asserts `kv('session:...:...')` contains the serialized events. happy-dom compatible.

**Risk:** `kvSet` is sync cache + async IDB. Fast enough that users never notice. Browser storage quota: IndexedDB soft-limits are gigabytes; negligible concern.

---

### P3 — Extract `derive.js` and `display.js`

**Goal:** Pure `state → view → displayMaps` pipeline. Engine moves out of state and into derive-time construction.

- **New:** `src/derive.js`:
  - `export function derive(state, sgf, config) → view`.
  - `view = {phase, engine, currentMove, showingMove, moveIndex, totalMoves, libertyExercise, changedGroups, mistakesByGroup, isLockedVertex}`.
  - Internally constructs a fresh `QuizEngine(sgf, true, config.maxQuestions)`, replays `state.events.filter(e => e.kind === 'advance' || e.kind === 'rewind')` through `engine.advance()` / re-`new QuizEngine`. (Reusing current engine's `advance` and `activateQuestions`.)
  - If perf becomes an issue: memoize by `(sgf, events.length)` — dispatch is the only thing that changes events; one recompute per dispatch.
- **New:** `src/display.js`:
  - `export function buildMaps(view, state, {isFinished, showSeqStones}) → {signMap, markerMap, paintMap}`.
  - Replaces the imperative 60-line block in `quiz.jsx:429-493`.
  - `export function rotateMaps(maps) → maps`. Pure transpose.
  - `export function orderGroupsByDisplay(groups, rotated) → displayIdx`. Extracts the `displayIdx` sort from current `quiz.jsx:201-206`.
- **Modify:** `src/session.js`:
  - Remove engine from state. `init(sgf, config) → {cursor:0, marks:Map, ..., events:[]}` (no engine).
  - `step(state, evt)` becomes fully pure — no engine mutation. `hasExercise` is derived, not stored. Phase is derived.
  - Actually re-read current `step` after P1: it uses engine for `advance` (to know `engine.currentMove`, `showingMove`), for `setMark` (locked-vertex check), for `submit` (checkLibertyExercise). All those operations move to `derive.js`.
  - The pure `step` becomes a very small function: `advance` bumps cursor, `setMark` updates marks map (locked-vertex check now relies on `view.isLockedVertex`, which lives in `derive`). Submit stores a flag; the actual evaluation runs during `derive`.
  - **This is the biggest structural move in the whole plan.** `step` gets simpler; `derive` absorbs the engine work.
- **Modify:** `src/quiz.jsx`:
  - `let view = useMemo(() => derive(state, sgf, config), [state, sgf, config])`.
  - Replace `let maps = useMemo(() => { let m = buildMaps(view, state, {isFinished, showSeqStones}); return rotated ? rotateMaps(m) : m }, [view, state, isFinished, showSeqStones, rotated])`.
  - The 60 imperative lines become 2 calls.
- **Tests:**
  - New `derive.test.js` — fold fixture events, snapshot `view` per step. Layer A extension.
  - New `display.test.js` — given a canned `view`, assert `maps` output. Small, targeted.

**Risk:** the engine-out-of-state move is the most complex transform in the plan. Keep P3 behind a feature-preserving invariant: all fixture snapshots must remain identical (same derived view values) across the refactor. Any snapshot diff = semantic drift to investigate.

---

### P4 — Extract `effects.js`

**Goal:** Side effects (sounds, parent callbacks, addReplay) move out of Quiz's dispatch into a pure `sideEffectsFor` function.

- **New:** `src/effects.js`:
  - `export function sideEffectsFor(prev, next, event, ctx) → Effect[]`.
  - `Effect` variants: `{kind:'sound/click'}`, `{kind:'sound/mark', value}`, `{kind:'sound/correct'}`, `{kind:'sound/wrong'}`, `{kind:'sound/complete', stars}`, `{kind:'onProgress', correct, total}`, `{kind:'onSolved', correct, total, scoreEntry}`, `{kind:'finalize', scoreEntry, popupData}`, `{kind:'wrongFlash'}`.
  - `ctx` holds things that aren't in state but are needed to compute effects: `{loadTimeMs, rotated, derive: (s) => view}`. Kept small; alternative is to recompute derive inside effects (redundant with Quiz's memo) but simpler. **Decision: ctx carries precomputed `prev` and `next` views.**
- **Modify:** `src/quiz.jsx`:
  - `dispatch` changes shape:
    ```
    function dispatch(evt) {
      let prev = state
      let next = events.reduce(step, init(sgf, config))  // or snapshot from state after setEvents
      setEvents(e => [...e, evt])
      let effects = sideEffectsFor(prev, next, evt, {prevView, nextView, loadTimeMs, rotated})
      for (let e of effects) runEffect(e)
    }
    ```
  - Or move effect computation to a `useEffect` that watches events; cleaner, and natural React. Needs care around double-run in StrictMode (effects should be idempotent with respect to event identity — use the event's `t` as a key).
  - **Decision: useEffect on events change.** Deduplicate by event index. Runs effects for events that weren't in the previous render's events.
  - `checkFinished` disappears entirely. Its body moves to:
    - Score computation → already in `scoring.js` (unchanged).
    - Display-order → `orderGroupsByDisplay` in `display.js` (moved in P3).
    - `addReplay` call → effect of kind `'finalize'`.
    - `setFinishPopup` → React state update triggered by `'finalize'` effect.
    - `playComplete(stars)` → effect of kind `'sound/complete'`.
    - `onSolved(correct, total, scoreEntry)` → effect of kind `'onSolved'`.
- **Tests:**
  - `effects.test.js` — given `prev/next/event`, assert the effect list. All pure, microseconds.
  - Existing `sounds.test.js` untouched.

**Risk:** StrictMode double-render. Effects must be idempotent or deduplicated. Use `useRef({lastRunIdx: -1})` to track.

---

### P5 — Split `quiz.jsx`

**Goal:** 650-line Quiz becomes an orchestrator + three focused subcomponents.

**Split into 4 commits (one per new file):**

#### P5.1 — `quiz-board.jsx`

- **New:** `src/quiz-board.jsx` exports `<QuizBoard />`.
- **Props:** `{maps, vertexSize, rangeX, rangeY, onVertexClick, onVertexPointerDown, onVertexPointerUp, wrongFlash, isFinished, feedbackClass, showingMoveClass}`.
- **Moves:** the `<Goban>` render + the `board-container` className assembly (`quiz.jsx:500-518`).

#### P5.2 — `quiz-wheel.jsx`

- **New:** `src/quiz-wheel.jsx` exports `<RadialMenu />` (already a component today, just extracts to file) and `useWheel(...)` hook.
- **`useWheel({vertexSize, commitMark, boardRowRef})`** returns `{wheel, onVertexPointerDown, onVertexPointerUp}`. Owns the pointer-move/up window listeners and wheelRef/wheelUsedRef refs currently in quiz.jsx:300-361.
- **Moves:** `WHEEL_ZONES`, `getWheelZone`, `RadialMenu` component, all pointer-handling from `quiz.jsx:140-361`.

#### P5.3 — `quiz-finish.jsx`

- **New:** `src/quiz-finish.jsx` exports `<FinishPopup />` and `<StatsBar />`.
- **Props (FinishPopup):** `{stars, accPoints, speedPoints, parScore, pointsByGroup, maxGroups, maxSpeed, elapsedSec, onClose}`.
- **Moves:** the finish-popup JSX (`quiz.jsx:520-559`), `StatsBar` component (`quiz.jsx:629-651`), `formatDate`, `scoreLabel`.

#### P5.4 — Quiz orchestrator cleanup

- **Modify:** `src/quiz.jsx` — becomes the composer. Owns `events` state + `dispatch` + layout effect + keyboard hooks + `confirmExit` + top-level JSX that wires everything together.
- Target: ~150 lines.
- **Delete** anything that moved to P5.1/5.2/5.3.

**Tests:**
- Layer A still green (no semantic change).
- Layer B DOM snapshot — expect no diff on any fixture.
- New render.test.jsx checks for each subcomponent: `<QuizBoard />` with mock maps, `<RadialMenu />` visual smoke, `<FinishPopup />` with a canned scoreEntry.

---

### P6 — Navigation module + `app.jsx` simplification

**Goal:** Eliminate history API, extract sibling-nav logic, replace reducer-like logic in app.jsx with small hooks.

- **New:** `src/navigation.js`:
  - `export function siblings(sgfs, cwd)` — filter by path, sort by uploadedAt + filename.
  - `export function nextUnsolved(siblings, currentId, scoreLookup)` — returns `{sgf, reason: 'unsolved'|'imperfect'|'least-recent'}`. Parameterized on `scoreLookup = (id) => ({accuracy, latestDate})` so tests don't need db.
  - `export function stepSibling(siblings, currentId, delta)` — cyclic.
- **New:** `src/useActiveSgf.js` — `useActiveSgf() → {active, select, clear}`. Owns `kv('activeSgf')` persistence internally.
- **New:** `src/useSgfs.js` — `useSgfs() → {sgfs, refresh}`. Memoized sgfs + db invalidation.
- **Modify:** `src/app.jsx`:
  - Remove `useEffect` for popstate, replaceState, pushState. All history API removed.
  - Remove `selectCount` (P2 already did this, re-verify).
  - Remove `refreshPosition`; compute position inline: `let siblings = useMemo(() => siblings(sgfs, cwd), ...); let index = siblings.findIndex(s => s.id === active?.id)`.
  - `goStep`, `goNextUnsolved` → call `navigation.js` functions.
  - `markSolved`, `saveProgress`, `handleLoadError` — unchanged in shape, just smaller context.
  - Target: ~40 lines.
- **Modify:** `src/library.jsx`:
  - `pickable` + "first unsolved" + "first imperfect" logic → replaced by single `nextUnsolved` call.
  - Progress-hero IIFE simplified to: `let next = nextUnsolved(filesHere, null, ...); if (!next) return <AllPerfect />; return <NextButton sgf={next.sgf} reason={next.reason} />`.
  - Enter-keyboard handler uses same `nextUnsolved` call.
- **Tests:**
  - `navigation.test.js` — unit tests for `siblings`, `nextUnsolved`, `stepSibling`. Pure functions, trivial.
  - Existing library tests (if any) updated.
  - Manual: browser back button no longer does anything special (history integration removed); verify page-load from PWA works.

**Risk:** popstate/pushState removal may surprise users who rely on browser-back to exit a puzzle. Mitigation: Escape key already exits (`tryBack`). Document in commit message.

---

### P7 — Extract `importer.js`

**Goal:** File/folder/URL/archive upload pipeline leaves `library.jsx`.

- **New:** `src/importer.js`:
  - `export async function importFiles(files) → Records`.
  - `export async function importFolder(dirHandle) → Records`.
  - `export async function importUrl(url) → Records`.
  - Shared helpers (`parseAndCollect`, `archivePrefix`, batching progress callback).
  - Progress callback: `importFiles(files, onProgress: (done, total) => {})`.
- **Modify:** `src/library.jsx`:
  - `handleFiles`, `handleFolder`, `fetchUrl` → call `importer.importFiles`/`importFolder`/`importUrl`.
  - Remove `parseAndCollect`, `archivePrefix`, `collectSgfFiles` (moved to importer).
  - Library becomes a browsing component; ~250 lines, down from 479.
- **Tests:**
  - `importer.test.js` — unit tests for `parseAndCollect`, `archivePrefix`. SGF content fixtures for parsing.
  - `archive.test.js` unchanged.

---

### P8 — Cleanup

**Goal:** Remove all dead code, stale comments, defensive guards the refactor exposed.

- **Remove:** `ghostStoneMap` — created but never written; in `quiz.jsx` and `quiz-board.jsx`.
- **Remove:** empty `onVertexPointerUp = useCallback(() => {}, [])` if Goban tolerates absence.
- **Remove:** defensive `if (active.id)` guards in `app.jsx:113, 117` (offensive programming).
- **Remove:** `handleLoadError` wrapper in `app.jsx:172-174` — just pass `clearSgf` as `onLoadError`.
- **Remove:** any remaining `selectCount` remount-key traces.
- **Audit:** comments. Preserve all real comments and TODOs. Remove comments that became stale through phases (e.g. the `// Legacy data: puzzles solved before event logging` note in P2.5 if auto-resume semantics make it obsolete — though it doesn't, since `wasSolved` flow survives).
- **Audit:** the 8 repeated `{id, content, path: s.path || '', filename, solved}` constructions. If P6's hooks haven't absorbed them all, extract a final helper.
- **Tests:** no new tests. All existing green.

---

## Dependency graph

```
P0 (fixtures) ──┬──► P1 ──► P2 ──► P2.5
                │                    │
                │                    ▼
                │                   P3 ──► P4 ──► P5
                │                                  │
                ├─────────────────► P6             │
                │                                  │
                └─────────────────► P7             │
                                                   ▼
                                                   P8
```

- P6 and P7 are orthogonal to the Quiz-internal track (P1–P5). Could interleave. For clarity we linearize.
- P8 is last because some dead code becomes visible only after structure changes.

---

## Commit Discipline

- Never bundle structural and behavioral changes in the same commit.
- Never bundle visual and behavioral changes.
- Tests green at the end of every commit.
- When a snapshot changes, that's a behavioral change — it gets its own commit with the diff inspectable.
- When a test is deleted, double-check before doing so. Prefer updating to deleting.
- Never amend commits after they're on a shared branch.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Event schema drift during refactor | `eventSchemaVersion: 2` frozen in P0; changes require a `fixture-migrate` entry in the same commit. |
| Engine rebuild cost in `derive` | Measure first. Typical session: ≤40 advances; rebuild ~40ms. Memoize on `events.length` if profiled hotspot. |
| Fixture corpus too small | 11 back-filled + ~15 fresh = ~25. If a post-refactor regression slips through, *then* invest in legacy compact decoder. |
| Layer B flakiness | DOM snapshots at phase boundaries only, not every event. Keep broad coverage in Layer A. |
| P3's engine-out-of-state move | All fixture snapshots must remain bit-identical across P3. Any diff = stop and investigate. |
| StrictMode double-run of effects | Deduplicate by event index in P4; use a ref to track `lastRunIdx`. |

---

## Out of Scope

- CSS cleanup. Classname stability preserved.
- Engine rewrite (`engine.js`), scoring rewrite (`scoring.js`), SGF parsing (`sgf-utils.js`).
- Db schema changes beyond `addReplay` bump (kv keys for `session:*` and `replay:*` are additions, not schema migrations).
- Routing library. One-route app, stays one-route.
- State management library (Redux/Zustand). `useState` + pure reducers is enough.
- Multi-device sync. Local-only.
- Decoder for legacy compact event format (`v:2` compact, `v:undefined`). Deferred; probably never.

---

## Known Behavior Changes (running log)

Filled in as phases land. Intentional behavior shifts; users will notice these even though they are not regressions.

- **P2 — canonical fixture timestamps deterministic.** The generator (`scripts/gen-canonical-fixtures.mjs`) now overwrites `event.t` with the event index after constructing a session, so regeneration is bit-identical across machines and run speeds. User-recorded fixtures are untouched (their `t` values come from the original session's clock).
- **P2.5 — eager event persistence; start-fresh on reopen.** Every dispatched event now mirrors to `kv('session:<sgfId>:<startTime>')`. Abandoning a puzzle mid-play leaves a `session:*` key in kv (preserved as raw history; never cleaned up). Reopening an unsolved puzzle **always starts fresh** — previous `session:*` records are not loaded back into the UI. Solved-puzzle review (`wasSolved && restored`) still folds the latest `replay:*` record as before.
- **P6 — browser history removed.** The prior pushState/popstate integration is gone. Browser back/forward no longer navigates between puzzles or between library folders. OS back button on mobile exits the PWA rather than stepping through the internal stack. Escape still exits a puzzle; breadcrumbs still navigate cwd.
- **P8 — `ghostStoneMap` and `onVertexPointerUp` no-op retained.** Both are Goban API props that TsumeSight doesn't populate but Shudan expects. Planned removal deferred because passing `undefined` risks @sabaki/shudan behavior change and there is no device CI to verify mobile pointer-up handling. Left as dead weight in display.js and quiz-wheel.jsx; drop if a later Shudan upgrade makes them cleanly optional.

## Definition of Done

1. All phases merged (P0 through P8).
2. Layer A + B + C green in CI.
3. Fixture corpus ≥ 20 cases covering small/large boards, semeai/life-and-death/capture, perfect/partial/failed, rewind/restart, finalize by correct and by max-submits.
4. Each of `quiz.jsx`, `library.jsx`, `app.jsx` < 200 lines.
5. `session.js` exports exactly `{init, step, pointsByGroup}`. `derive.js` exports exactly `{derive}`. `display.js` exports exactly `{buildMaps, rotateMaps, orderGroupsByDisplay}`. `effects.js` exports exactly `{sideEffectsFor}`.
6. Manual smoke test on dev server: play one puzzle end-to-end; solve a puzzle; restart; open a previously-solved puzzle; behavior matches pre-refactor.
