# TODO

## Skip for now

Spec: Support branched SGF trees. Traverse variations via DFS, allow undo to explore alternate lines.

Spec: Cross-device sync for library and scores (e.g., cloud storage, export/import, or sync protocol).

Spec: Blind mode — starts from initial position, user guesses moves similar to liberty guessing. Needs experimentation to find the right format.

Spec: Difficulty heuristic — primary factor is move count, secondary is number of small-liberty small groups. Needs experimentation. Display on tiles for now.

## Spec-ed, can start working

## To spec
If you see this section non-empty, we should clarify until it is unambigous what to implement.

- When inspecting answers, we should also see a bar of dots below the board and each represents one comparative answer. It should be green or red and clicking it would show the letters z x again and somehow signify your answer.
- The text on the mobile is too small. Why is it too small?
- We should improve the algorithm for comparative question selection.
- Sound doesn't work, sound settings button.
- Mark as resolved button is invisible.
- Clicking "?" Acts as Library marking


## Done

Spec: Comparison phase — after liberty questions on each move, ask comparison questions for adjacent opposite-color group pairs where both groups were liberty-questioned and liberty difference is 0 or 1. Label two neighboring stones Z (left/above) and X, user taps the group with more liberties or presses = Equal (Space). Green hero-style Equal button. Same feedback as liberty phase (correct sound + advance, wrong sound + 150ms shake + advance). Replay button stays in place across liberty and comparison phases via visibility:hidden Equal during liberty.

Spec: Action hints below the board — contextual instructions for each quiz state: "Tap board for the next move. Remember the sequence." during advance, "Tap all liberties of ? group, then tap ? or Space" during liberty, "Tap the group with more liberties, or = Equal" during comparison.

Spec: Dev/prod toggle in hamburger menu — two side-by-side buttons (Prod | Dev), active environment green, inactive gray and clickable to switch.

Spec: Tooltips for Go players new to the app. Standard tooltip behavior on all non-obvious UI elements (buttons, tile numbers, percentages). Users know Go but not what to do on each screen.

Spec: Submit liberties by tapping the question mark on the questioned group. Require minimum 1 mark before tap submits. Remove the separate Submit button.

Spec: Show sequence — "Sequence" button during liberty questions shows the initial position, user taps through the move sequence one at a time (each move shown briefly on the base position, like during the quiz), then returns to the question. No progress lost.

Spec: Suppress haptic feedback on long-press on go stones gesture.

Spec: In review mode, tap a group to toggle liberty display on/off (replace current hold-to-show).

Spec: Replay must be a temporary overlay. Exiting replay restores the original finished state (engine, scores, review markers) exactly as before replay started.

Spec: Minimize Shudan board padding/borders to maximize board size on screen.

Spec: Auto-rotate board 90 degrees when the problem fits.

Spec: Show a back-to-library button on the finished/scores screen.

Spec: Add a "Retry" button on the finished screen to re-attempt the same problem.
