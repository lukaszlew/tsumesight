# TODO

## Skip for now

Spec: Support branched SGF trees. Traverse variations via DFS, allow undo to explore alternate lines.

Spec: Cross-device sync for library and scores (e.g., cloud storage, export/import, or sync protocol).

Spec: Blind mode — starts from initial position, user guesses moves similar to liberty guessing. Needs experimentation to find the right format.

Spec: Difficulty heuristic — primary factor is move count, secondary is number of small-liberty small groups. Needs experimentation. Display on tiles for now.

## Needs more design

Spec: Comparative question mode — new mode selectable from menu. After each move, highlight 2 opposite-color groups, user taps the one with more liberties. If only 1 changed group, skip question. Pair selection heuristic: prefer small liberty difference, tiebreak by last-move group. Build spanning tree on group adjacency graph to select pairs. More design needed on pair selection.

## Done

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
