# Refactor spec — cursor-based quiz session

Target model for the quiz session after the refactor. Authoritative reference during the rewrite. Supersedes the state machine documented in `STATE_SPACE.md` once landed.

## Core concept

A quiz session is a cursor moving over a sequence of N moves, plus an exercise that appears only once the cursor reaches the end.

```
cursor=0   cursor=1       cursor=2   ...   cursor=N
  │           │              │                │
initial   after move 1   after move 2   all moves shown → exercise
```

Everything else — phase, what's displayed, whether Done is available — is derived from `cursor`, `submitCount`, and `feedback`.

## Session state (single source of truth on engine)

| Field | Type | Notes |
|---|---|---|
| `cursor` | `0..N` | How far through the moves we are |
| `marks` | `Map<vertexKey, int>` | User's current liberty-count marks |
| `submitCount` | `int` | Number of Done presses this session |
| `feedback` | `PerGroupStatus[] \| null` | Populated after each Done; reflects most recent submit |
| `startTime` | timestamp | For elapsed-time scoring |
| `events` | `Event[]` | Canonical append-only log |

Nothing else. No `showingMove`, `libertyExerciseActive`, `finished`, `libMarks`, `libFeedback`, `submitAttemptsRef`, `mistakesRef`, `mistakesByGroupRef`, `lastWrongRef`, `savedEngineRef`, `seqSavedRef`, `seqIdx`, `replayMode`, `replayDataRef`, `replayFinished`, `replayAttempt`, `replayProgress`.

## Events

All state transitions go through one dispatch point: `applyEvent(event)`.

```
{t, kind: 'advance'}                  // cursor++, requires cursor < N
{t, kind: 'rewind'}                   // cursor = 0; marks/submitCount/feedback/clock preserved
{t, kind: 'setMark', vertex, value}   // absolute; value=0 clears. Requires cursor === N and not finalized
{t, kind: 'submit'}                   // submitCount++, compute feedback. Requires cursor === N
```

Events record timestamps relative to `startTime`. Recorded for later analysis (no playback UI for now).

## Derived phase (for UI readability only)

```
phase = cursor < N                             ? 'showing'
      : submitCount === 0                      ? 'exercise-fresh'
      : allCorrect(feedback) or finalized      ? 'finished'
      :                                          'exercise-feedback'
```

`finalized = submitCount >= MAX_SUBMITS` (config constant, default 2).

## UI actions → events

| User action | Event | Precondition |
|---|---|---|
| Space / tap board (not in exercise) | `advance` | `cursor < N` |
| Tap vertex (in exercise) | `setMark` | `cursor === N` and not finalized |
| Done button / Space (in exercise) | `submit` | `cursor === N` and not finalized |
| **Rewind** button (new) | `rewind` | any time |
| **Restart** button | *new session* (not an engine event — creates fresh engine) | any time |
| Esc | confirm-exit overlay (unchanged) | — |
| Mark-as-solved (skip, `preSolve`) | writes sentinel "skipped" event log, marks DB solved | before any `submit` |

## Scoring (unchanged business logic)

- Per-group points: `[10, 5, 0]` for `[0, 1, 2+]` wrong submits on that group.
- Accuracy points = `10 × groupCount − 5 × totalMistakes`, floor 0.
- Cup time = `3s + 1.5s × moves + 1.5s × groups`.
- Speed points = `round(2 × cup − elapsed)`, floor 0.
- Stars by `(acc + speed) / parScore` thresholds; 5★ also requires 0 mistakes.

Computed via pure fold over `events` + final engine state at finish.

## Tapping rules during exercise

- **Any intersection is tappable.** No group-locked check.
- Tapping inside an **unchanged / pre-marked** group places a mark that scores 0 (not a penalty). TODO: may count as a mistake later — comment in code.
- Tapping a stone of a **correctly-answered** group is allowed and may un-correct that group on next submit. Correctness is recomputed each submit; no "locked correct" state.

## Stored data

| Data | When written | Lifetime |
|---|---|---|
| Score entry | on finish | kept forever |
| Event log | on finish | kept forever (no playback UI yet; useful for future stats) |
| `solved` flag | on finish or mark-as-solved | kept |
| "skipped" sentinel event log | on mark-as-solved | kept |

Old replay event logs (cyclic-mark format) remain in IDB untouched. They have no consumer until a new stats feature reads them; safe to ignore for this refactor.

## Restore behavior

| Stored state for SGF | On reopen |
|---|---|
| solved + event log present | minimal "solved" review (no playback, stats later) |
| solved + no event log (legacy) | minimal "solved (no record)" review |
| solved via skip (sentinel log) | minimal "solved (skipped)" review |
| not solved | fresh session, `cursor=0` |

## What stays identical

- Liberty-counting algorithm and group-change detection (engine.js `_setupLibertyExercise` core logic).
- Scoring math (scoring.js).
- Sound triggers: stone-click on show, mark-sound on mark, correct/wrong on submit, completion fanfare on finish.
- Finish popup layout (stars, per-group breakdown, time).
- Eye toggle (show-sequence-stones) on finish screen.
- Confirm-exit on Esc.
- Library / archive / SGF loading.
- IDB schema for score entries.

## Reference puzzles (for mental walk-through & spike)

Taken from `src/engine.test.js`. Walk these through the new model to sanity-check.

### 1. `simpleSgf = (;SZ[9];B[ee];W[ce];B[gc])`
- 3 moves, all on empty board, no captures.
- N=3. After `cursor=3`, exercise on changed groups (likely just the 3 single stones played).
- Trace: `advance` × 3 → `setMark` × 3 → `submit` (hopefully all correct) → finished.

### 2. `captureSgf = (;SZ[9];B[aa];W[ba];B[ee];W[ab])`
- 4 moves, W[ab] captures B[aa] (corner capture).
- At `cursor=4`: B[aa] is gone, W[ba] and W[ab] form a group with new liberties.
- Trace: 4 × `advance` → marks on the W groups and B[ee] → `submit`. The captured stone is correctly absent from the exercise.

### 3. `setupSgf = (;SZ[9]AB[dd][ed]AW[de][ee];B[cd];W[ce])`
- Setup stones + 2 moves. Initial B group and W group both change liberties during the sequence.
- Trace: 2 × `advance` → marks on the changed groups → `submit`.

For each: run mentally through cursor advance → marks → submit → finished. Confirm no step in the new model feels awkward.

## What #5 (the spike) is

A 30-minute standalone validation *before* touching `quiz.jsx`. Concretely:

1. Create `src/session.js` (new file) with a `QuizSession` class implementing the model above: `cursor`, `marks`, `submitCount`, `feedback`, `applyEvent()`.
2. Reuse the existing board/liberty code from `engine.js` (don't rewrite the Go logic — that's solid).
3. Write `src/session.test.js` with one test per reference puzzle: construct a session, dispatch events, assert final state (score, feedback, cursor).
4. If tests pass: model is proven. The UI rewrite becomes mechanical.
5. If awkwardness appears: fix the spec *now*, before UI work.

The spike lives alongside the old engine; no quiz.jsx changes yet. Low commitment, high de-risking.
