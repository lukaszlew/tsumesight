# Checkpoint Feature Spec

## 1. User / UI perspective

### The button

A **"Mark Libs"** button sits in the bottom action bar, next to the existing
advance/submit controls.

| Condition | State |
|-----------|-------|
| `maxQuestions === 0` | Hidden entirely |
| Phase is Exercise or Finished | Hidden |
| Fewer than 4 moves played in the current segment | Disabled (gray) |
| Current board would produce zero `changed` groups | Disabled (gray) |
| Mid-advance animation in progress | Disabled (gray) |
| Otherwise | Enabled |

### Pressing the button

1. The board freezes at the current position.
2. The liberty-marking overlay appears — identical to the end-of-sequence
   exercise: changed groups show `?`, unchanged groups show their pre-marked
   count.
3. The user marks groups with the radial wheel and submits.
4. On finalization (first all-correct submit, or `maxSubmits` exhausted):
   - The board **snaps**: all previously invisible (played) stones become
     visible as initial-position stones.
   - The overlay disappears. The user is immediately back in Showing phase,
     looking at what appears to be a fresh starting position.
   - If no moves remain → Finished phase.

### Rewind

R-key rewinds within the current segment only.  At the first move of a segment
R-key does nothing (same as cursor=0 today).  Rewind never crosses a rebase
boundary.

### End of the last segment

Unchanged from current behavior: after the final `advance`, an exercise
auto-activates if `changed` groups exist.  The "Mark Libs" button is hidden in
Exercise and Finished phases so there is no double-trigger.

### Scoring (to be designed separately)

Each segment is scored independently with `i` resetting to 0 at the start of
each segment, because the previously hidden stones become visible initial stones
— the user sees a fresh problem.  Scoring formula: `B + i·K` per move in the
segment, multiplied by time and accuracy factors.

---

## 2. Implementation

### New concepts

**Segment** — a contiguous slice of the move sequence between two rebase
boundaries.  Defined by `segmentStart: number` (the global `cursor` value at
which the current segment began; 0 for the first segment).

**Checkpoint exercise** — an exercise triggered mid-sequence by the button,
as opposed to the automatic end-of-sequence exercise.

### State additions

```
segmentStart   number    cursor at which current segment began (initially 0)
checkpointActive  bool   true while a checkpoint exercise is in progress
                         (derived: last 'checkpoint' event not yet followed
                          by a 'rebase' event)
```

`totalMoves` and `cursor` are unchanged — cursor still counts globally from 0
to `totalMoves + 1`.

### Phase selector change

```js
export function phase(state) {
  if (state.checkpointActive) return 'exercise'   // NEW: mid-game exercise
  if (state.cursor <= state.totalMoves) return 'showing'
  if (!state.hasExercise) return 'finished'
  if (finalized(state)) return 'finished'
  return 'exercise'
}
```

### Assertion changes

`_doSetMark` and `_doSubmit` currently assert `cursor === totalMoves + 1`.
Replace with `assert(phase(state) === 'exercise', ...)` so both mid-game and
end-of-sequence exercises pass.

### New events

#### `{ kind: 'checkpoint' }`

Fired when the user presses "Mark Libs".

Handler `_doCheckpoint(state)`:
1. Assert `phase(state) === 'showing'`.
2. Assert `state.cursor - state.segmentStart >= 4`.
3. Call `state.engine.setupCheckpointExercise()` (see engine changes below).
4. Assert the result has at least one `changed` group (button guard ensures
   this, but assert for safety).
5. Set `state.checkpointActive = true`.
6. Clear `state.marks`, reset `state.submitCount`, `state.submitResults`
   (fresh exercise state for this segment).
7. Set `state.hasExercise = true`.

#### `{ kind: 'rebase' }`

Fired automatically by the UI immediately after finalization of a checkpoint
exercise (not the final-segment exercise).

Handler `_doRebase(state)`:
1. Assert `state.checkpointActive && finalized(state)`.
2. Call `state.engine.rebase()` (see engine changes below).
3. Set `state.segmentStart = state.cursor`.
4. Set `state.checkpointActive = false`.
5. Clear `state.marks`, reset `state.submitCount`, `state.submitResults`,
   `state.hasExercise = false`.

### Rewind change

`_doRewind` currently does `new QuizEngine(sgf, ...)` and sets `cursor = 0`.

New behavior: rebuild engine, replay `segmentStart` moves, then rebase:

```js
function _doRewind(state) {
  let engine = new QuizEngine(state.sgf, true, state.maxQuestions)
  for (let i = 0; i < state.segmentStart; i++) engine.advance()
  if (state.segmentStart > 0) engine.rebase()
  state.engine = engine
  state.cursor = state.segmentStart
  state.checkpointActive = false
  state.hasExercise = false
  state.marks = new Map()
  // submitCount and submitResults are intentionally NOT reset (session-level)
}
```

### Engine changes (`engine.js`)

#### `_setupLibertyExercise(referenceBoard)`

Add a `referenceBoard` parameter (defaults to `this.initialBoard`).  Replace
all uses of `this.initialBoard` inside the method with `referenceBoard`.
Existing call site passes nothing → no behavior change.

#### `setupCheckpointExercise()`

```js
setupCheckpointExercise() {
  // referenceBoard = board state at the start of this segment
  // (= this.initialBoard, which rebase() keeps up to date)
  this._setupLibertyExercise(this.initialBoard)
  if (this.libertyExercise?.groups.some(g => g.changed))
    this.libertyExerciseActive = true
}
```

The guard in `_advanceLiberty` (`if moveIndex < totalMoves return`) is left
untouched — checkpoint exercises bypass `_advanceLiberty` entirely.

#### `rebase()`

```js
rebase() {
  this.initialBoard = this.trueBoard
  this.baseSignMap = this.trueBoard.signMap.map(row => [...row])
  this.invisibleStones.clear()
  this.boardHistory = []
  this.libertyExercise = null
  this.libertyExerciseActive = false
}
```

`moveIndex` and `moves` are untouched — the engine continues advancing through
the global move sequence.

### UI wiring (`quiz.jsx` / `QuizBoard`)

- Render "Mark Libs" button when `maxQuestions > 0` and
  `phase !== 'exercise' && phase !== 'finished'`.
- Disable when `cursor - segmentStart < 4`, or `showingMove`, or
  `changedGroupsForCurrentBoard().length === 0`.
- On click: `dispatch({ kind: 'checkpoint' })`.
- In the finalization effect (where the end-of-sequence exercise currently
  auto-advances): after a checkpoint exercise finalizes, additionally
  `dispatch({ kind: 'rebase' })`.

### `wouldHaveChangedGroups()` engine helper

Needed to drive the button's disabled state without firing the real exercise.
Must NOT call `this.random` — doing so would advance the Mulberry32 PRNG and
corrupt the representative-vertex selection for the actual exercise.
Implement as a read-only scan that returns `true` as soon as one `changed`
group is found, without assigning vertices.

---

## 3. Testing strategy

### Unit: `engine.js`

Add tests in `engine.test.js` covering:

- `_setupLibertyExercise(referenceBoard)` — pass an explicit reference board
  that differs from the final board; confirm `changed` flags are computed
  against the supplied reference, not `this.initialBoard`.
- `setupCheckpointExercise()` — after N advances (N < totalMoves), call it;
  confirm `libertyExerciseActive` is true and groups reflect the mid-sequence
  board, not the final board.
- `rebase()` — confirm `initialBoard === trueBoard`, `invisibleStones` is
  empty, `boardHistory` is empty, `baseSignMap` matches.  Advance a move after
  rebase; confirm it builds on the rebased position.
- `wouldHaveChangedGroups()` — confirm it returns false on a board where all
  groups are pre-markable, true otherwise; confirm calling it does **not**
  advance `this.random` (check vertex selection is identical before and after).

### Unit: `session.js`

Add tests in `session.test.js` covering:

- `phase()` returns `'exercise'` when `checkpointActive` is true, regardless
  of cursor value.
- `checkpoint` event: assert preconditions throw on wrong phase; confirm
  `checkpointActive` true, marks/submitCount reset.
- `rebase` event: confirm `segmentStart` advances to cursor, engine rebased,
  `checkpointActive` false.
- `rewind` after rebase: cursor resets to `segmentStart` (not 0); engine board
  matches the rebased position.
- `setMark` / `submit` work during a checkpoint exercise (cursor is mid-range,
  not `totalMoves + 1`).
- Full two-segment sequence: advance 10 moves → checkpoint → exercise →
  rebase → advance 5 more moves → end-of-sequence exercise → finished.

### Fixture / golden tests

Add at least one fixture in `/fixtures/` that exercises a checkpoint:

```json
{
  "sgf": "<a problem with ≥10 moves>",
  "config": { "maxSubmits": 3, "maxQuestions": 2 },
  "events": [
    ...advance × 6...,
    { "kind": "checkpoint" },
    ...setMark × N...,
    { "kind": "submit" },
    { "kind": "rebase" },
    ...advance × remaining...,
    { "kind": "submit" }
  ],
  "goldens": {
    "segmentCount": 2,
    "scoreEntry": { ... }
  }
}
```

Run `refresh-fixture-goldens.mjs` (dry-run first) after the fixture is stable.

### Schema migration

Bump `EVENT_SCHEMA_VERSION` to 3.  Add a no-op migrator in
`fixture-migrate.js` for `v2 → v3` (existing fixtures have no checkpoint or
rebase events; the migration is identity).

### Checkpoints for manual testing

1. After engine refactor only (steps 1–3): run existing test suite — zero
   regressions expected.
2. After session events (step 4): run `session.test.js` and new unit tests.
3. After UI wiring (step 5): open a ≥8-move problem, press "Mark Libs" at
   move 4 — button should be enabled.  Complete exercise, confirm snap.
   Confirm rewind stays within segment.  Reach end of second segment,
   confirm auto-exercise fires normally.

### Regression guard

The existing fixture snapshots (`__snapshots__/*.snap.json`) must all pass
unchanged after steps 1–3 (pure refactor).  Any snapshot change at that stage
is a bug, not expected output.

---

### Fixture / migration

Add `EVENT_SCHEMA_VERSION` bump.  New events `checkpoint` and `rebase` must
be handled in `fixture-migrate.js` (no-op migration — they simply didn't
exist in older fixtures).
