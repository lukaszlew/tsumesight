# App state space

Map of every phase/mode flag in the quiz, what they mean, how they combine, and where the messy edges are. Two scopes: **engine** (`src/engine.js`) and **quiz UI** (`src/quiz.jsx`). Always read UI on top of engine.

---

## 1. Engine phase — what the puzzle is doing

Engine phase is **derived from three booleans**, not a single enum. At any moment exactly one of these is true (or none, during construction / transient moments).

| Flag | File | Set by | Cleared by |
|---|---|---|---|
| `showingMove` | engine.js:71 | `advance()` (line 134) | `activateQuestions()` (line 143) |
| `libertyExerciseActive` | engine.js:64 | `activateQuestions()` when a changed group exists (line 145) | `submitLibertyExercise()` (line 206), `advance()` past end (line 92, 121) |
| `finished` | engine.js:73 | `advance()` past last move (line 89) | never (terminal) |

### Engine phases

```
IDLE            — showingMove=F, libertyExerciseActive=F, finished=F
                  Only at construction before first advance(). With
                  config.autoShowFirstMove (true by default in app init,
                  quiz.jsx:195) you leave this state immediately.

SHOWING_MOVE    — showingMove=T
                  A stone was just played; user taps to advance.
                  currentMove is set, moveIndex points past it.

EXERCISE        — libertyExerciseActive=T
                  User marks liberty counts on stones. Only entered on
                  the LAST move (see _advanceLiberty, engine.js:304).
                  Entered only if at least one group has changed libs
                  (activateQuestions, line 144).

FINISHED        — finished=T
                  All moves played, exercise submitted (or skipped).
                  libertyExercise OBJECT is intentionally kept for the
                  review display (engine.js:91), but the ACTIVE FLAG is
                  forced false (lines 92, 121, 206). See edge E1 below.
```

### Engine transitions

```
IDLE
  └─advance()──▶ SHOWING_MOVE

SHOWING_MOVE
  ├─activateQuestions()──▶ EXERCISE       (last move, has changed groups)
  ├─activateQuestions()──▶ (cleared)      (non-last move: showingMove=F, no exercise;
  │                                        caller must call advance() to re-enter
  │                                        SHOWING_MOVE — see quiz.jsx:394)
  └─activateQuestions()──▶ FINISHED       (last move, no changed groups, then advance())

EXERCISE
  └─submitLibertyExercise()──▶ (cleared)  then caller calls advance() ──▶ FINISHED
                                          (quiz.jsx:441, replay at quiz.jsx:675)

FINISHED                                  (terminal; also reachable from fromReplay, see §2a)
```

**Note:** after `activateQuestions()` on a non-last move, the engine is briefly in “no phase” (all three false). `advance` in quiz.jsx:394-406 is responsible for immediately driving it back to SHOWING_MOVE. This transient is never observed by the UI.

### EXERCISE internal sub-states (2-attempt retry)

EXERCISE is not a single flat state. `submitAttemptsRef` (quiz.jsx:144) drives a two-attempt cycle, with `libFeedback` as the visible marker:

```
EXERCISE/ANSWERING   libFeedback = null, submitAttemptsRef = 0
  └─ submit: all correct?
       ├─ yes ──▶ commit + engine.advance() ──▶ FINISHED
       └─ no  ──▶ submitAttemptsRef = 1, show feedback

EXERCISE/FEEDBACK     libFeedback = [...statuses], submitAttemptsRef = 1
  • user can tap a wrong/missed group → libFeedback[i] = null,
    libMarks updated for that group; other groups stay frozen (quiz.jsx:471-493)
  └─ submit: all correct OR submitAttemptsRef >= 2 (forceCommit)?
       ├─ yes ──▶ commit + engine.advance() ──▶ FINISHED
       └─ no  ──▶ still showing feedback (shouldn't reach: second submit forces commit)
```

Implemented at quiz.jsx:411-460. Key detail: on force-commit the wrong marks are recorded as mistakes; `lastWrongRef` is attached to `engine.libertyExercise.lastWrong` (quiz.jsx:437) so the FINISHED review screen can show the last wrong answer in red (quiz.jsx:777-795).

### 2a. Alternate engine entry: `QuizEngine.fromReplay`

A **third** way the engine reaches FINISHED, bypassing normal play and replay:

- Trigger: `wasSolved && restored` at mount (quiz.jsx:185-192).
- Source: app-level `active.restored` flag is set on app reload when the last-active SGF is re-hydrated from `localStorage` (app.jsx:36).
- Mechanism: `QuizEngine.fromReplay(sgf, history, maxQ)` (engine.js:403) advances through all moves, activates the exercise, applies a boolean-per-group history (true=correct mark, false=no mark), submits, and advances to FINISHED.
- Edge case: empty history → engine stays in SHOWING_MOVE (engine.js:420-424), not FINISHED. So a "solved" puzzle with no recorded history re-opens as a fresh attempt.

This is why the FINISHED state has three producers (normal play, replay playback, restore), and why `engine.libertyExercise` must be present on a finished engine regardless of how it got there.

### 2b. `engine.libertyExercise` is mutated from outside

The object survives past `libertyExerciseActive=false` (edge E1) but also **grows new fields** at commit time:

- `.userMarks` — the Map of user's final marks (set inside engine.js:204).
- `.lastWrong` — the accumulated wrong-answer map (attached from UI at quiz.jsx:437, *before* calling submit).

So "is there an exercise object?" is not the same as "what phase is the engine in?" is not the same as "what data does the object carry?". The object is effectively a scratchpad shared between engine and UI, and FINISHED code reads both engine-written and UI-written fields off it.

---

## 2. Quiz UI mode — what the user is doing *around* the engine

The UI layers five orthogonal modes on top of the engine. Most of these are **mutually exclusive by UX but not enforced by invariant** — the only barrier is which buttons are rendered.

| Mode flag | File:line | Effect |
|---|---|---|
| `error !== null` | quiz.jsx:128 | Full-screen error overlay; nothing else renders. Terminal. |
| `replayMode` | quiz.jsx:157 | Watching recorded playback. Engine is swapped. Board disables normal interaction. |
| `seqIdx > 0` | quiz.jsx:167 | "Show sequence" mode: step through the moves again. Engine is swapped. |
| `confirmExit` | quiz.jsx:133 | "Exit this problem?" overlay; board click dismisses. |
| `finishPopup !== null` | quiz.jsx:142 | Score popup overlay; dismissible. |

Plus one **derived** mode flag:

| Derived flag | Definition | Where used |
|---|---|---|
| `preSolve` | `!engine.finished && engine.results.length === 0` (quiz.jsx:606, 872) | Enables "Mark as solved" button (quiz.jsx:998); Enter toggles solved (quiz.jsx:624). Means "user hasn't submitted any exercise yet". |

The default, when none of the above is set, is **normal play** — the engine phase drives everything.

### Scoring / mistake-tracking refs (span EXERCISE → FINISHED)

These refs aren't modes but they're state that transitions across phases and ends up consumed by the finish popup:

| Ref | File:line | Written | Read |
|---|---|---|---|
| `mistakesRef` | quiz.jsx:143 | accumulated during EXERCISE submit (`wrongCount` added, quiz.jsx:428, 453) | `checkFinished` for scoring (quiz.jsx:226, 232) |
| `submitAttemptsRef` | quiz.jsx:144 | incremented per submit (quiz.jsx:423) | EXERCISE sub-state logic (`forceCommit`, quiz.jsx:424) |
| `mistakesByGroupRef` | quiz.jsx:145 | wrong count per group (quiz.jsx:431, 449) | finish popup `pointsByGroup` (quiz.jsx:233-243) |
| `lastWrongRef` | quiz.jsx:140 | wrong answer per group key during EXERCISE (quiz.jsx:432, 450) | attached to `engine.libertyExercise.lastWrong` at commit (quiz.jsx:437); cleared after (quiz.jsx:439) |
| `replayEventsRef` | quiz.jsx:153 | `recordEvent()` during normal play | persisted on FINISHED via `addReplay` (quiz.jsx:250); **reset** by `startShowSequence(fresh=true)` (quiz.jsx:342) — so "Restart" from FINISHED *discards* the replay recording |
| `loadTimeRef` | quiz.jsx:129 | set at mount; reset by `startShowSequence(fresh=true)` (quiz.jsx:341) | elapsed time at FINISHED (quiz.jsx:225) |

**All of these are reset atomically only by `startShowSequence(fresh=true)`** (quiz.jsx:334-345). That function is the only "full reset from FINISHED" path. Normal `exitShowSequence` and `restoreSavedState` (replay exit) do not touch these.

### `wheelUsedRef` — click vs wheel arbitration

`wheelUsedRef` (quiz.jsx:150) is set to `true` on pointer-down (quiz.jsx:534) and consumed by the next vertex click (quiz.jsx:507). It prevents the click that normally advances from firing after a wheel-driven mark. Trivial but load-bearing: without it, committing a mark by tap would also advance the move during SHOWING_MOVE. (Not actually a risk because wheel only opens during EXERCISE, but the guard is unconditional.)

### Mode interactions

```
                  ┌─────── normal play ─────────┐
                  │ engine phase drives UI      │
                  │ recordEvent() captures inputs│
                  └──────────────┬───────────────┘
                                 │
                   ┌─────────────┼──────────────┐
                   ▼             ▼              ▼
           startShowSequence  startReplay  setConfirmExit(T)
           (quiz.jsx:329)    (quiz.jsx:263)
                   │             │
              seqIdx=1      replayMode=T
           seqSavedRef ←    savedEngineRef ←
             old engine       old engine
           new fresh engine  new fresh engine
                   │             │
                   ▼             ▼
          advanceShowSequence  useEffect replays
          on click/space       events (quiz.jsx:646)
                   │             │
           Esc / reach end   Esc / click / end
                   │             │
           exitShowSequence  restoreSavedState
           restores old      restores old
           engine            engine
                   └─────────────┘
                        ↓
                   normal play
```

Both show-sequence and replay follow the same pattern: **save engine, create a fresh engine, drive it, restore original on exit**. They use *different* saved-state refs (`seqSavedRef` vs `savedEngineRef`/`savedSolvedRef`) and different exit paths. See edge E4.

### Recording

`recordEvent()` (quiz.jsx:175) is gated by `replayModeRef.current`. It's **not** gated by `seqIdx`, but in practice show-sequence runs on a temp engine whose actions do not go through `recordEvent`. Events:

- `{t, a:1}` — space/enter advance (quiz.jsx:513, 636)
- `{t, v:[x,y]}` — vertex tap (advance during show, or mark cycle during exercise) (quiz.jsx:478, 496)
- `{t, ex:{...}}` — exercise submit (quiz.jsx:436)

Recorded events are persisted on completion (`addReplay`, quiz.jsx:250). Replay replays those event objects against a **fresh engine** (not a snapshot).

---

## 3. Replay deep-dive — why it feels suspicious

Replay is not "show the saved final state." It's **"re-enact the user's input stream on a fresh engine."**

```
startReplay(scoreEntry)  quiz.jsx:263
  ├─ fetch events from IDB via getReplay()
  ├─ save current engine to savedEngineRef
  ├─ new QuizEngine(sgf)  +  advance()      ← fresh engine, SHOWING_MOVE
  ├─ reset libMarks/libFeedback/wrongFlash
  └─ setReplayMode(true)

useEffect [replayMode, replayAttempt]  quiz.jsx:646
  async play():
    for each event:
      await timeout(evt.t - prev.t)
      apply event to engine:
         evt.ex → submitLibertyExercise + advance  (→ FINISHED)
         evt.v  → if EXERCISE: cycle mark; else: advance through SHOWING_MOVE
         evt.a  → advance through SHOWING_MOVE
      setReplayProgress(...)  + rerender()
  after loop: setReplayFinished(true)   ← pauses on final state

exitReplayEarly() / click board / Esc → restoreSavedState()
  restores savedEngineRef (and savedSolvedRef), clears replay flags.

restartReplay() → brand new fresh engine + replayAttempt++ (retriggers useEffect).
```

### Replay sub-states

While `replayMode=true`, you have two meaningful sub-states:

| | `replayFinished=F` | `replayFinished=T` |
|---|---|---|
| Engine phase | whatever the replayed event stream has reached | FINISHED (terminal) |
| Hint text | "Tap board or press Esc to exit" | "Replay complete. Tap board or press Esc to exit." |
| useEffect loop | still awaiting next event | done, idle until exit |

### Why the UI condition is tangled

The board-display code (quiz.jsx:768) reads:

```js
if (engine.finished && !replayMode && seqIdx === 0) { …review display… }
else                                                  { …live display… }
```

**This is deliberate and correct, but reveals the orthogonality problem:** the engine can be `finished=true` in THREE different scopes — the real finish, during replay once the event stream reaches the end, and after show-sequence drives through the final move. The UI must pick display mode by UI mode, not just engine phase.

---

## 4. Suspicious patterns / confusion sources

**E1 — `libertyExercise` object outlives `libertyExerciseActive` flag.**
Object persists for the finished review screen (engine.js:91); the flag gets cleared on the same line. Any code that reads "is there an exercise?" must check which of the two it actually means. Minor trap.

**E2 — Engine phase is implicit across 3 booleans, no enum.**
Readers must mentally reduce the truth table. The derived phases would be cleaner as `engine.phase = 'showing' | 'exercise' | 'finished' | 'idle'` with the booleans as private state. Multiple sites already derive it (quiz.jsx:392-406, quiz.jsx:688-711, quiz.jsx:768).

**E3 — `seqIdx` is a counter used as a boolean.**
Set to `1` on enter (quiz.jsx:356), compared as `> 0` (quiz.jsx:509, 614, 768). The number has no meaning. Rename to `showSequenceActive: boolean` or similar.

**E4 — Show-sequence and replay are duplicated code paths.**
Both save an engine, spawn a fresh one, run it with event-like logic, and restore. They have **separate** saved-state refs (`seqSavedRef` vs `savedEngineRef`/`savedSolvedRef`), separate entry/exit functions, and separate keyboard handlers. Candidates for a single "ephemeral engine session" abstraction.

**E5 — Exercise UI spreads across three state slots.**
`wheel`, `libMarks`, `libFeedback` are independent but only meaningful together during EXERCISE. The combinatorics (quiz.jsx:833-868) already get dense. A tagged union `{ kind: 'answering' | 'feedback' | 'touching', marks, wheel?, feedback? }` would compress the rendering logic.

**E6 — Mutual exclusion between modes is UI-enforced, not code-enforced.**
`replayMode`, `seqIdx>0`, `confirmExit`, `error` can theoretically combine in silly ways. Today they can't because the buttons that enter each mode are only rendered in the right UI state (e.g. Replay button only when `finished && !replayMode`, quiz.jsx:992). A single mode enum would make this invariant explicit.

**E7 — Replay during EXERCISE advances differently than during SHOWING_MOVE.**
In the replay loop (quiz.jsx:677-698), `evt.v` does one of two totally different things depending on engine phase — cycle a mark *or* advance. This matches how the same click works during recording, but it means replay is sensitive to the engine being in the *same* phase as when recorded. If the engine state ever diverges (different `maxQ`, different randomness → different `changed` groups), replay silently does the wrong thing.

**E8 — Two places feed the engine during replay, both reimplementing "advance".**
Compare quiz.jsx:394-406 (normal advance) with quiz.jsx:687-711 (replay) with quiz.jsx:373-389 (show-sequence). Three copies of the same `showingMove → activateQuestions → advance` dance, each slightly different. Prime simplification target.

**E9 — `engine.libertyExercise` is a shared scratchpad.**
The engine writes `.groups` and `.userMarks`; the UI writes `.lastWrong`. FINISHED-view rendering (quiz.jsx:775-803) reads all three off the same object. This makes the object's "type" depend on which phase wrote to it last. Consider splitting engine-owned data (`groups`, `userMarks`) from UI-owned review data (`lastWrong`).

**E10 — FINISHED has three producers, one consumer.**
The engine reaches FINISHED via (a) normal play → advance past last move, (b) replay playback ending on `evt.ex`, (c) `fromReplay` static constructor on restore. All three must leave the engine with the *same* visible shape (`libertyExercise` populated, `results` filled, `finished=true`), but only (a) fills `mistakesByGroupRef`/`mistakesRef` via the UI layer. After (b) or (c), those refs are stale or zero — which is fine for (b) because the finish popup isn't shown during replay, and for (c) because `solvedRef.current` is set true so `checkFinished` short-circuits (quiz.jsx:221). Relies on a non-obvious invariant.

**E11 — Replay recording is discarded silently on Restart.**
`startShowSequence(fresh=true)` (the "R" key or Restart button when finished) resets `replayEventsRef` to `[]` (quiz.jsx:342). The user's old replay is already persisted in IDB by that point (via prior `addReplay` at quiz.jsx:250), so it's not lost from storage — but the in-memory buffer that would've been saved on the *next* completion is wiped. If the user completes again after Restart, the new replay overwrites conceptually but stores under a new `date` key. Worth verifying whether old replays stay accessible.

---

## 5. Cheat-sheet: what "what's on screen" means

| engine.finished | engine.libertyExerciseActive | engine.showingMove | replayMode | seqIdx | User sees |
|---|---|---|---|---|---|
| F | F | T | F | 0 | SHOWING_MOVE: stone + number, tap to advance |
| F | T | F | F | 0 | EXERCISE/ANSWERING: mark liberty counts, `submitAttempts=0` |
| F | T | F | F | 0 | + `libFeedback≠null` → EXERCISE/FEEDBACK, `submitAttempts=1`, taps correct individual groups |
| T | F | — | F | 0 | FINISHED: review board, stats bar, maybe popup; `preSolve=false` |
| F | F | F | F | 0 | IDLE (only if `autoShowFirstMove=false`) or transient between moves; `preSolve=true` enables Mark-as-solved button |
| — | — | — | T | 0 | REPLAY: fresh engine, event-driven playback |
| — | — | — | F | >0 | SHOW SEQUENCE: fresh engine, user taps through |
| any | any | any | F | 0 | + `confirmExit=T` → exit overlay |
| any | any | any | any | any | + `error≠null` → error overlay (takes over entire quiz) |

---

## 6. Key file:line map

- **Engine state init** — engine.js:61-75
- **advance()** (SHOWING_MOVE entry, FINISHED entry) — engine.js:87-140
- **activateQuestions()** (SHOWING_MOVE exit, EXERCISE entry) — engine.js:142-147
- **submitLibertyExercise()** (EXERCISE exit, writes `userMarks`) — engine.js:177-208
- **fromReplay()** (alt FINISHED producer) — engine.js:403-441
- **App-level `active.restored` flag** — app.jsx:33-37
- **Quiz UI state declarations** — quiz.jsx:119-168
- **recordEvent gating** — quiz.jsx:175-179
- **Initial engine construction** (incl. restore-from-solved) — quiz.jsx:182-204
- **checkFinished / FINISHED side effects** — quiz.jsx:219-261
- **Replay lifecycle** — quiz.jsx:263-327
- **Show-sequence lifecycle** — quiz.jsx:329-389
- **Normal advance / submit** — quiz.jsx:391-460
- **Replay playback effect** — quiz.jsx:646-728
- **Board display decision** — quiz.jsx:768-870
- **Mode-switched bottom bar** — quiz.jsx:959-992
