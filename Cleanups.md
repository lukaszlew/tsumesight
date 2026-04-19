# Cleanups — post-refactor work list

Items deferred from the V4 UI refactor (see git log for the P0–P8 commit series if you need implementation history). Sorted by priority: **impact ÷ (work × risk)**, fastest-first within each priority tier. Effort tags: `[S]` under 1h, `[M]` 1–3h, `[L]` 3h+, `[XL]` multi-day.

## Status

**Priority 1 — all 11 items shipped** (commits C1–C11, 2026-04-18). Every P1 entry below is now historical reference. Total churn: ~180 lines deleted from src/ (engine dead code, sounds variants, autoShowFirstMove branches), 11 commits, test count 257 → 269.

P2/P3/P4 items remain as-specified.

---

## Priority 1 — Do these first (high impact, low risk, short)

### `[S]` Refresh `ARCHITECTURE.md`

Migrate the module layout + data-flow diagram + known behavior changes into `ARCHITECTURE.md`. Zero risk. Unblocks anyone reading the repo cold.

### `[S]` Dead code in `engine.js`

`staleness` and `prevLibs` maps are populated on every `advance()` but never read. Commit `47b3983` removed their consumers (`getGroupScores`) but left the bookkeeping. Verify with grep, remove both maps and their update logic. Also check whether `boardHistory` is load-bearing — if it's only used in `_setupLibertyExercise` and nowhere else, keep; otherwise trim. ~30 lines out. Engine stays deterministic; tests stay green.

### `[S]` Decide `autoShowFirstMove`

The config toggle is `false`. There are three branches in `quiz.jsx` (mount effect, `doRewind`, `doRestart`) "kept for parity." Pick one:

- **(a)** Remove the flag + branches. User always taps to see move 1.
- **(b)** Set to `true`, remove the flag, auto-advance always.

Dead config flags are worse than either commitment.

### `[S]` `sounds.js` dead branches

`config.markSoundMode` has four values (`repeat`, `interval`, `pluck`, `interval_pluck`) but only `interval_pluck` is active. The three unused `playMarkX` functions are ~60 lines of dead audio code. Delete the three unused variants; `playMark` calls `playMarkIntervalPluck` directly; drop `markSoundMode` from config.

### `[S]` `?` missed-group sentinel → symbol / constant

`state.marks.set(key, { value: '?', color: 'red' })` mixes a string sentinel with numeric values. Replace with `MISSED = Symbol('missed')` (or a named constant); display.js checks `value === MISSED` to render the "?" literal. Minor type-mix cleanup.

### `[S]` Magic numbers into `config.js`

- `wrongFlash` timeout (150ms) — inline in the effects runner.
- Cup time formula (3s base + 1.5s/move + 1.5s/group) — literal numbers in `effects.js:computeFinalizeData`.
- `maxLibertyLabel` is already in config — good precedent.

Name the constants, hoist.

### `[S]` `vitest.config.js` centralization

No config file today; per-file `// @vitest-environment happy-dom` directives. Consolidate into a single `vitest.config.js` with `environment: 'happy-dom'` default. Removes a preamble line from every new test.

### `[S]` `fake-indexeddb` polyfill

The `.catch(() => {})` on `kvSet` / `kvRemove` (added in P0.1) silences IDB-missing errors in tests. It's a smell — production errors also get silenced. Better:

- Add `fake-indexeddb` as a devDep.
- Polyfill `globalThis.indexedDB` in vitest setup.
- Remove the `.catch()` — let real production errors surface.

### `[S]` `app.jsx` polish + `useSgfs()` hook

Move `ErrorBoundary` to `src/error-boundary.jsx`. Introduce `useSgfs()` hook caching `getAllSgfs()` at app level — eliminates two `getAllSgfs()` re-fetches per Prev/Next click. Result: `app.jsx` under 60 lines. Also unblocks the perf work below.

### `[S]` `getBestScore` + library subdir stats

- `getBestScore` linear-scans scores per call; called once per file tile per render. Cache by `(sgfId, scoresVersion)`.
- Library subdir stats are currently O(dirs × sgfs). Single pass over sgfs into a `{dir → {total, solved, latestDate}}` map gives O(n+d).

Scale-harmless today; 10 minutes of "better default shape."

### `[S]` Layer C tests (wheel math + keyboard)

5–10 targeted tests in `quiz-wheel.test.js`:

- `getWheelZone(dx, dy)` across all 6 zones (cardinal + intermediate angles).
- Pointer-down + simulated window move/up → `commitMark` called with right vertex/value.
- Keyboard: Enter finished→onNextUnsolved, Space exercise→submit, Escape confirm flow, 'r' rewind/restart.

Closes a real test gap at the UI edge; pure function tests trivially pass.

---

## Priority 2 — Medium investment, medium payoff

### `[S]` Fixture corpus growth (user work)

Current corpus: 9 user-recorded (all capture-race) + 9 canonical = 18. Biased toward 9x9 semeai. Missing: life-and-death, 13x13/19x19 boards, multi-group exercises with pre-marked groups, rewind mid-setMarks, orientation-rotated recordings.

One hour of guided play → export → re-run converter → ~40 fixtures. Non-negligible chance new fixtures expose a regression the current set missed.

### `[S]` Crash-recovery integration test

Now that P2.5 persists events eagerly: mount Quiz, dispatch 3 events (no finalize), assert `kv('session:<sgfId>:<startTime>')` contains them. Not much coverage, but explicitly pins the contract.

### `[S]` Converter script path-coverage test

`scripts/zip-to-fixtures.mjs` has three classification branches (v:3 full, v:2 verbose, v:2 compact-skip) + replay validation. No tests. Build a tiny synthetic zip in a test, run converter programmatically, assert output.

### `[S]` Debounce `kvSet` eager persistence

P2.5 writes on every event. Burst of 5 setMarks → 5 IDB writes. Harmless (fire-and-forget) but wasteful. Coalesce with a 200ms debounce. Measure IDB write impact first; may not be needed.

### `[M]` Layer B — DOM snapshot at finalize

For each of 18 fixtures, render `<Quiz />` into happy-dom, fold events via a testable `initialEvents` prop, snapshot `container.innerHTML` at final state. Requires small Quiz API change (accept `initialEvents` prop; ~5 lines). Catches class-name drift, conditional JSX regressions, button text, aria attrs.

### `[M]` CI pipeline

If `.github/workflows/` doesn't exist, add one:

```yaml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm test
      - run: npm run build
```

Suite runs in ~1 second; total CI under a minute.

### `[M]` `library.jsx` decomposition

`library.jsx` is 379 lines with eight concerns. Natural cuts:

- `library-menu.jsx` — hamburger + dropdown + PWA install + reset (~60 lines).
- `library-tile.jsx` — dir tile, file tile, `useLongPress`, `scoreColor`, `splitDirName` (~80 lines).
- `usePwaInstall.js` — hook wrapping `deferredPrompt` + `beforeinstallprompt` (replaces module-level side effect).

Target: `library.jsx` at ~180 lines. No behavior change. Big visible refactor; medium time investment.

---

## Priority 3 — Architectural completion (do when mentally fresh)

### `[S]` Document "events is truth, state is derivable"

P2.5 persists events eagerly. With state also JSON-serializable (after item below), future work might be tempted to persist state directly. That introduces drift risk. Add a comment block in `session.js` + `quiz.jsx` establishing the invariant: events canonical, state derived, never both persisted.

No code change. 10 minutes.

### `[L]` Finish V4 — engine out of `state`

The one architectural compromise the refactor left: `state.engine` is still mutable, carried across events. P3 kept it pragmatically. Real V4:

- `state` = `{sgf, config, cursor, marks, submitCount, submitResults, events, startTime}`. Engine gone.
- `derive(state)` rebuilds `new QuizEngine(state.sgf, ...)` and replays advances up to cursor.
- Memoize by `(sgf, events.length)` — one entry per dispatch; invalidates when events array identity changes.
- `step(state, 'submit')` builds a transient engine to evaluate marks, stores result, throws engine away.

Payoffs:

- State is JSON-serializable. `kv('session:*')` could store state directly (we won't — see above).
- `events.slice(0, k).reduce(step, init(sgf, config))` gives state at any step k, pure.
- `step` becomes truly pure (no shared mutable engine across state references).

Risk: engine rebuild must be deterministic. It already is (`mulberry32(hashString(sgf))` + events). But `_setupLibertyExercise` consumes the RNG at final move — must produce same representative vertex on rebuild. Layer A snapshots pin this; regressions would be loud.

### `[M]` Mark-coloring out of `step`'s submit handler (depends on above)

`_doSubmit` currently mutates `state.marks` to overlay green/red/? colors. That's the reducer embedding display concerns. Cleaner:

- `state.marks` stores raw user input (value only, no color).
- `view.marks` overlays colors from `state.submitResults[last]` in derive.
- Display uses `view.marks` — no visible change.

Easier after engine-out-of-state because everything in state is plain data by then.

### `[M]` Incremental fold (depends on above)

`useMemo(() => events.reduce(step, init(sgf, config)), [events, ...])` re-folds the entire array per dispatch. For N events: O(N) per dispatch, O(N²) across a session. Typical cost today: 30 events × 1ms ≈ 30ms per dispatch.

Fix: track previous events + state in a ref; on dispatch `next = step(prev, newEvent)`. O(1).

Blocked on step being truly pure (previous engine must not be mutated by the latest step call).

---

## Priority 4 — Only if specifically pressured

### `[L]` Legacy compact replay decoder

The 95 `v:2` compact replays in user exports (`{a:1,t}`, `{v:[x,y],t}`, `{ex:{...},t}`) were skipped by the converter because they encode a different UI model (tap-to-cycle, not swipe). Decoder would reverse-engineer the old click semantics into synthesized verbose event streams.

Only worth the ~4-6h investment if the expanded fixture corpus (item 22) misses coverage the legacy logs would provide.

### `[L]` SGF parser replacement

`sgf-utils.js` is homegrown. Works on the current 30k-SGF corpus. Edge cases (nested variations, complex setup, encodings) might bite. `@sabaki/sgf` is already a dep — migrate `parseSgf` to use it internally, keep output shape.

Risk: different parsing behavior could shift moveCount/boardSize for edge cases. Would need to run against full corpus before committing.

### `[L]` `db.js` context-provider rewrite

`kvCache` module-global is a race-condition magnet in theory. Preact's synchronous render + single-tab PWA makes it fine in practice. Cleaner version: React context + hook. Cost > benefit today.

### `[XL]` Engine immutability

`QuizEngine.advance()` mutates internal state. Purely functional engine would return a new engine per advance (persistent data structures or clone-cost acceptance). Gains: engine in state cleanly, engine-level time-travel, trivial incremental fold. Cost: significant rewrite of engine.js.

Mutation is localized and hash-seeded RNG keeps behavior deterministic regardless. Skip unless a concrete bug pushes you there.

---

## Reading guide

- **One free hour:** top 3 Priority 1 items.
- **Half a day:** all of Priority 1.
- **Full day:** Priority 1 + Priority 2 through `library.jsx` decomposition.
- **Week of mental space:** add Priority 3 — real V4 architectural completion.
- **Everything else:** only as a response to specific pressure.
