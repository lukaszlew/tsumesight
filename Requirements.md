# Requirements

Behavior requirements collected from design conversations. These are the
user-facing rules that drive the session model and UI. For implementation
detail, see `REFACTOR_SPEC.md` (model) and the code.

## Session lifecycle

A quiz session is a linear walk through a move sequence of length N, followed
by an exercise on the final position.

- **Cursor** ranges 0 .. N+1:
  - 0 = empty board, before any advance.
  - 1 .. N = showing move K.
  - N+1 = past all moves; exercise active (or finished if no scorable groups).
- **One visible state change per user action.** A user's single `advance` tap
  produces exactly one visible transition: show move 1 → show move 2 → ... →
  show move N → exercise. The last move is always rendered in its own
  "showing" state before the exercise takes over.
- **Rewind** sets the cursor back to 0 but preserves marks, feedback, submit
  count, clock, and event log. It's a visual rewind, not a state reset.
- **Restart** is separate from Rewind: it begins a fresh session from scratch
  (new clock, new marks, new event log). Each completion saves its own replay
  entry under a new timestamp; older replays stay viewable.
- **Two distinct keys/buttons**: `R` = Restart when finished, Rewind otherwise.
  (Keeping them separate avoids the overload the old app had.)
- The clock runs continuously once started. Rewind does not pause or penalize
  time.

## Marking rules

- **Marks live per intersection**, not per group. A mark is a numeric liberty
  label (1 .. 5+) or a `'?'` sentinel placed by evaluation.
- **Tapping marks an intersection.** The tap handler does not check group
  membership; only the scoring logic at Done time does.
- **Tapping an empty (non-stone) intersection is allowed** and stores a mark.
  Scoring ignores it (no penalty today). Leave a comment in the code: such
  marks may become a scored mistake in a future version.
- **Tapping a pre-marked label intersection is blocked.** Pre-marked groups
  are the unchanged groups (liberty count didn't change during the sequence,
  or `5+ throughout`). Only the single intersection where the label is
  displayed is locked; other stones of the same group remain tappable.
- **Tapping anywhere else, including on stones of correctly-answered
  groups, is allowed.** Correctness is recomputed on each Done — there is no
  "locked correct" state after submit.

## Done / submit / feedback

- **Done** evaluates the user's current marks against the scorable groups and
  **overwrites** the marks with the evaluation result, including colors:
  - Correct group: user's mark gains green color at the tapped intersection.
  - Wrong group: user's mark gains red color at the tapped intersection.
  - Missed group (no mark on any stone of the group): a `'?'` with red color
    appears at the group's representative intersection.
- **No separate display-layer state for feedback.** The evaluation writes
  into the marks map directly; display reads marks and renders value + color.
  After Done, the colored state persists on the board.
- **The user's next tap overrides one intersection** and clears its color.
  Other intersections keep their eval colors until the next Done. The user
  fixes what the eval showed them rather than losing eval on any tap.
- **Submit attempts are capped** at a configurable constant (currently 2).
  After the cap is reached, the current marks are force-committed and the
  session finalizes. If all groups are correct before the cap, it finalizes
  immediately. The cap must be easy to change.

## Scoring

(Business logic — treat as a hard requirement; see `src/scoring.js`.)

- Each scorable group is worth up to 10 points.
- Per-group points = `[10, 5, 0]` for `[0, 1, 2+]` wrong submit attempts that
  included that group.
- **Retries cost a mistake even if fixed.** Submitting wrong on attempt 1,
  fixing, and submitting correct on attempt 2 yields 5 points for that group,
  not 10. This is the intended rule.
- Speed bonus and par time are set by `computeParScore` / `computeCup` /
  `computeSpeedPoints` in `scoring.js` — unchanged from the previous version.
- Five stars requires a perfect per-group score AND zero mistakes.

## Replay / event log

- **Every user event** (advance, rewind, setMark, submit) is recorded with a
  timestamp in an append-only log on the session.
- **On completion**, the log is persisted to IndexedDB alongside the score
  entry (one replay per completion, keyed by date).
- **No playback UI for now.** The replay data is kept for future analysis
  (e.g. time-in-phase statistics). The old auto-playback feature and its
  Replay button are removed.
- **Old stored replays** (pre-refactor, cyclic-mark format) are left
  untouched. They are not re-readable with the new player. Score entries are
  preserved regardless.
- Event logging in Rewind-spawned sub-sessions is not a thing: rewind stays
  inside the same session and keeps its log.

## Restore (reopening a puzzle)

On app reload, the last-opened SGF is restored.

- **Solved, event log exists**: open in a minimal "solved" review — board
  shows the final eval state. No finish popup, no scoring recomputation.
- **Solved, no event log** (legacy): opens as a fresh session. A "solved
  (no record)" review is a deferred polish item.
- **Not solved**: open fresh at cursor 0.

There is no in-quiz "mark as solved" / skip action. If the user wants to
hide uninteresting or incorrect puzzles from navigation, that's a data-side
operation on the library record, not a quiz UI feature.

## UI features that must stay

- **Esc** shows an exit-confirmation overlay; a second Esc or the Exit button
  confirms.
- **Sound toggle** button persists user preference.
- **Eye toggle** on the finished screen switches between "final board (with
  played stones)" and "initial position."
- **Keyboard shortcuts**: Space advances / submits, Enter submits or
  advances-to-next-problem when finished, Esc exits, R restarts or rewinds
  depending on phase. Tooltips include the keyboard shortcut in parentheses.
- **Radial marking wheel**: press-and-drag gesture for picking a liberty
  count; fast flick without seeing the wheel also commits. Unchanged from
  before the refactor.

## Design principles (collected)

These are the principles stated for the refactor; they guide future changes.

- **Single source of truth.** Anything derivable from other state should be
  derived, not stored.
- **Pure functions where possible.** Scoring and rendering should be
  pure-ish folds over session state.
- **Linear dataflow.** One dispatch point for state changes (`applyEvent`).
- **Minimize feedback loops.** No observer-style state syncing between
  independent slots.
- **Explicit over implicit.** Invariants stated in the code with assertions
  rather than hoped for.
- **Offensive programming.** Assert invariants; don't defensively tolerate
  broken input. Fail loud at the source.
- **No duplication.** Shared code paths get one implementation.

## Non-requirements (explicitly deferred)

These came up in discussion but were declared out of scope for the current
refactor:

- Replay playback UI (timing-preserving auto-play, pause/resume, speed
  control). The data is still recorded.
- Time-spent-per-phase statistics derived from event logs.
- Branched SGF variations / move-guessing modes (see `TODO.md`).
- Counting non-scorable marks (e.g. empty-intersection taps) as mistakes.
  Noted in code as a possible future rule.
