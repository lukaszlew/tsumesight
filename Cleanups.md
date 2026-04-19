# Cleanups — post-refactor work list

Items deferred from the V4 UI refactor (see `UiRefactorPlan.md`). Ranked by leverage × clarity × risk. Effort tags: `[S]` under 1 hour, `[M]` 1–3 hours, `[L]` 3 hours+, `[XL]` multi-day.

---

## Tier 1 — Mechanical wins (high leverage, low risk)

### 1. `library.jsx` decomposition `[M]`

`library.jsx` is still 379 lines with eight concerns welded together. Natural cuts:

- `src/library-menu.jsx` — hamburger + dropdown + PWA install + reset-data button (~60 lines out).
- `src/library-tile.jsx` — dir tile, file tile, `useLongPress`, `scoreColor`, `splitDirName` (~80 lines out).
- `src/usePwaInstall.js` — hook wrapping `deferredPrompt` + `beforeinstallprompt` listener, replaces the module-level side effect.
- Keep `library.jsx` as the browser orchestrator: loads sgfs, manages cwd, computes dir stats, wires the keyboard.

Target: `library.jsx` at ~180 lines. No behavior change.

### 2. `app.jsx` finishing polish `[S]`

- Move `ErrorBoundary` to `src/error-boundary.jsx` (20 lines; used once but shouldn't be inlined in the router).
- Introduce `useSgfs()` hook: loads and caches `getAllSgfs()` at app level. Eliminates two `getAllSgfs()` re-fetches in `goStep` / `goNextUnsolved` on every Prev/Next click. Also unblocks (13).
- Result: `app.jsx` under 60 lines.

### 3. Dead code in `engine.js` `[S]`

`staleness` and `prevLibs` maps are populated on every `advance()` but never read. Commit `47b3983` removed their consumers (`getGroupScores`) but left the bookkeeping. Verify with grep, remove both maps and their update logic. Also check whether `boardHistory` is load-bearing — if it's only used in `_setupLibertyExercise` and that one loop, keep; otherwise trim.

~30 lines out of engine.js. All tests stay green.

### 4. `sounds.js` dead branches `[S]`

`config.markSoundMode` has four values (`repeat`, `interval`, `pluck`, `interval_pluck`) but only `interval_pluck` is in current config. The three unused `playMarkX` functions are ~60 lines of dead audio code. Options:

- **(a)** Delete the three unused variants; `playMark` calls `playMarkIntervalPluck` directly. Drops `markSoundMode` from config too.
- **(b)** Keep the variants but hoist the shared oscillator scaffolding into a helper (`plucker`, `envelope`) — the DSP code repeats itself.

(a) is strict honesty (no variants = no choice). (b) keeps options while reducing duplication. Prefer (a); inline dev-time flexibility when it crosses into the product.

---

## Tier 2 — Architectural completion (medium risk, real gains)

### 5. Finish V4: engine out of `state` `[L]`

The one architectural compromise the refactor left: `state.engine` is still mutable, carried across events. P3 kept it pragmatically to avoid engine rebuild cost. Real V4:

- `state` shape becomes `{sgf, config, cursor, marks, submitCount, submitResults, events, startTime}`. Engine gone.
- `derive(state)` rebuilds `new QuizEngine(state.sgf, ...)` and replays advances up to cursor.
- Memoize by `(sgf, events.length)` — one engine cache entry per dispatch, invalidated automatically when events array identity changes.
- `step(state, 'submit')` builds a transient engine to evaluate marks, stores result in state, throws engine away.

Payoffs:

- State is JSON-serializable. `kv('session:*')` can store state directly (currently only events are persisted; state reconstructs on load).
- Time-travel for free: `events.slice(0, k).reduce(step, init(sgf, config))` gives state at step k without side effects.
- `step` becomes truly pure (no shared mutable engine across state references).

Risk: engine rebuild must be deterministic. It already is (`mulberry32(hashString(sgf))` + events). But partial replays need to consume the RNG at the exact same point — today `_setupLibertyExercise` calls `this.random()` once at the final move; rebuilding engine for submit-at-cursor=N+1 must produce the same representative vertex. Layer A snapshots pin this, so regressions would be loud.

### 6. Move mark-coloring out of `step`'s submit handler `[M]`

Currently `_doSubmit` mutates `state.marks` to overlay green/red/? colors. That's the reducer embedding display concerns. Cleaner:

- `state.marks` stores raw user input only (value, no color).
- `view.marks` (computed in derive) overlays colors from `state.submitResults[last]`.
- Display uses `view.marks` as it does today — no visible change.

User intent for "tap after submit to clear color" naturally falls out: overwriting `state.marks[key]` changes user intent; eval results aren't re-run until next submit.

Dependency: easier to do after (5) so engine state is derived consistently.

### 7. Persist state, not just events `[S after (5)]`

P2.5 writes `kv('session:*', JSON.stringify(events))` on every dispatch. With state also JSON-serializable (after (5)), we could persist full state and skip the fold-on-resume. But: events is canonical; state is derivative. If we persist both we have drift risk. If we persist only state we lose replayability. Keep events-only.

Resolution: document that events is truth, state is derivable. No code change — just make sure future work doesn't add a "persist state" shortcut.

---

## Tier 3 — Testing reach (Layer B + Layer C)

### 8. Layer B: DOM snapshot at finalize `[M]`

For each of the 18 fixtures, render `<Quiz />` into happy-dom, fold events via a testable `initialEvents` prop, snapshot `container.innerHTML` once (at final state). ~18 new snapshot files.

Requires a small Quiz API change: accept `initialEvents` prop for test injection (~5 lines). Production callers don't use it.

Catches: class-name drift, conditional JSX regressions, button text, aria attrs.

### 9. Layer C: pointer math + keyboard handlers `[S]`

5–10 tests in a `wheel.test.js` (or reuse `quiz-wheel.test.js`):

- `getWheelZone(dx, dy)` for all 6 zones (cardinal + intermediate angles).
- Pointer-down + simulated window move + up → verify `commitMark` called with right vertex/value.
- Keyboard: Enter in finished phase, Space in exercise phase, Escape in confirm state, 'r' in showing phase.

Pure function tests are trivial. Pointer simulation needs happy-dom PointerEvent mock; ~30 lines of setup.

### 10. Integration test for crash recovery `[S]`

Now that P2.5 persists events eagerly:

- Mount Quiz, dispatch 3 events (no finalize).
- Assert `kv('session:<sgfId>:<startTime>')` contains those events.
- This test already exists in spirit via `db.test.js`; extend to verify the specific key pattern quiz.jsx produces.

Not a lot of coverage, but explicitly pins the contract.

### 11. Converter script path-coverage test `[S]`

`scripts/zip-to-fixtures.mjs` has three classification branches (v:3 full, v:2 verbose, v:2 compact skip) and a replay-validation step. No tests. Build a tiny synthetic zip in a test, run the converter programmatically, assert output.

Not high-priority — the script is one-off tooling — but ~30 minutes of insurance.

---

## Tier 4 — Performance (measure first; only if hotspots)

### 12. Incremental fold `[M]`

Current `useMemo(() => events.reduce(step, init(sgf, config)), [events, ...])` re-folds the entire event array on every dispatch. For N events, O(N) work per dispatch — O(N²) across a session.

Better: track previous events + previous state via a ref. On dispatch, `next = step(prev, newEvent)`. O(1) per dispatch.

Requires step to be truly pure (5) so the previous-state reference isn't mutated by the latest step call. Blocked on (5).

Actual cost today: 30-event session × 1ms per step ≈ 30ms per dispatch. Noticeable on slower phones? Possibly. Measure first.

### 13. `getBestScore` + library subdir stats `[S]`

- `getBestScore` linearly scans all scores per call; called once per file tile per render. At 30,000 files × 5 scores each = 150k ops per library render. Harmless today but not great. Cache by `(sgfId, scoresVersion)`.
- Library subdir stats: currently O(dirs × sgfs). Rewrite as single pass building a `{dir → {total, solved, latestDate}}` map in O(sgfs).

### 14. Debounce `kvSet` eager persistence `[S]`

P2.5 writes on every event. A burst of 5 setMarks in 2 seconds writes 5 times. Harmless (IDB-backed, async) but wasteful. Coalesce with `requestIdleCallback` or a 200ms debounce. Measure IDB write impact first.

---

## Tier 5 — UX / config cleanup

### 15. Decide `autoShowFirstMove` `[S]`

The config toggle is `false`. There's branching code in `quiz.jsx` (mount effect, `doRewind`, `doRestart`) "kept for parity." Either:

- **(a)** Remove the config flag and the branches. User always taps to see move 1.
- **(b)** Make it `true`, remove the flag, auto-advance.

Decision, then removal. Having a dead config flag is worse than either commitment.

### 16. Magic numbers into `config.js` `[S]`

- `wrongFlash` timeout (150ms) — currently inline in the effects runner.
- Cup time formula (3s base + 1.5s/move + 1.5s/group) — literal numbers in `effects.js:computeFinalizeData`. Name the constants.
- `maxLibertyLabel` is already in config — good precedent.

### 17. `?` missed-group sentinel `[S]`

`state.marks.set(key, { value: '?', color: 'red' })` — magic string mixed with numbers. Could be `{ value: MISSED, color: 'red' }` where `MISSED = Symbol('missed')` or a named constant. Display.js checks `value === '?'` to render "?" literal.

Minor. Cleans up a type-mix.

---

## Tier 6 — Dev ergonomics

### 18. `vitest.config.js` `[S]`

Currently no config file; per-file `// @vitest-environment happy-dom` directives. Consolidate into a single `vitest.config.js` with `environment: 'happy-dom'` default. Simplifies new test creation.

### 19. `fake-indexeddb` polyfill `[S]`

The `.catch(() => {})` on `kvSet` / `kvRemove` (added in P0.1) silences IDB-missing errors in tests. It's a smell — production errors also get silenced. Better:

- Add `fake-indexeddb` as a devDep.
- Polyfill `globalThis.indexedDB` in `vitest.config.js` setup file.
- Remove the `.catch()` — let production errors surface.

### 20. CI pipeline `[M]`

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

Layer A + every test runs in 1-2 seconds; total CI under a minute.

### 21. `ARCHITECTURE.md` refresh `[S]`

Likely stale after the refactor. Should now reflect V4 + the new module layout + the data-flow diagram from the plan doc. Migrate the relevant sections from `UiRefactorPlan.md` into `ARCHITECTURE.md`; plan doc becomes an implementation history.

---

## Tier 7 — Fixture corpus growth

### 22. Play session to expand coverage `[S — user work]`

Current fixture corpus: 9 user-recorded (capture-race only) + 9 canonical = 18. Bias: mostly 9x9 semeai. Missing variety:

- Life-and-death problems (different liberty dynamics)
- 13x13 and 19x19 boards
- Multi-group exercises with pre-marked groups
- Rewind in the middle of setMarks (not just after a submit)
- Orientation-rotated recordings (viewport stored in v:3 goldens)

One hour of guided play → re-export → re-run converter → fixture corpus goes to ~40. Non-negligible chance new fixtures expose a bug no current fixture caught.

### 23. Legacy compact decoder (the 95 skipped replays) `[L]`

If the expanded corpus still misses coverage, decode the legacy `v:2` compact events (`{a:1,t}`, `{v:[x,y],t}`, `{ex:{...},t}`) into synthesized verbose event streams. Requires reverse-engineering the old click-cycle UI's tap semantics. Decoder lives in the converter script; synthesized events go through the same replay validation.

Deferred indefinitely. Only worth it if (22) proves insufficient.

---

## Tier 8 — Deeper engine / domain work (low-leverage, big rewrites)

Named for completeness; skip unless a concrete bug pushes you there.

### 24. Engine immutability `[XL]`

`QuizEngine.advance()` mutates `trueBoard`, `boardHistory`, internal state. A purely-functional engine would return a new engine per advance. Uses persistent data structures or accepts clone cost.

Gains: engine moves to state cleanly, time-travel works at engine level, incremental fold trivial.
Cost: significant rewrite.

Probably not worth it. The mutation is localized and the hash-seeded RNG makes behavior deterministic regardless.

### 25. SGF parser replacement `[L]`

`sgf-utils.js` is a homegrown parser. Works on the fixture corpus and the user's 30k SGFs. But edge cases (nested variations, complex setup, encodings) might bite. Consider replacing with `@sabaki/sgf` (already a dep — `package.json` lists it). Migrate `parseSgf` to use it internally, keep the output shape for back-compat.

Risk: different parsing behavior could shift moveCount / boardSize for edge-case SGFs. Run against full corpus first.

### 26. `db.js` rewrite `[L]`

`kvCache` as module-global is a race-condition magnet in theory. In practice, Preact's synchronous render + single-tab-per-PWA makes it fine. A cleaner version would use a context provider + hook. Cost > benefit for now.

---

## Recommended ordering if you had a full day

1. Tier 1 items 1–4 (2–4h): real decomposition wins, low risk.
2. Tier 3 items 8–9 (1.5h): closes visible regression gap.
3. Tier 5 items 15–17 (1h): dead-code / magic-number cleanup.
4. Tier 6 items 18–19 (1h): makes future test work cleaner.
5. Tier 2 items 5–6 (3–4h): real V4. Do when you have mental space.

Leave Tiers 4, 7, 8 for when specific pressure appears.
