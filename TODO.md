# TODO

## Needs conversation

Spec: Support branched SGF trees. Traverse variations via DFS, allow undo to explore alternate lines.

Spec: Cross-device sync for library and scores (e.g., cloud storage, export/import, or sync protocol).

Spec: Add tooltips to all non-obvious UI elements (buttons, tile numbers, percentages, move numbers). Design for learn-by-doing discoverability.

Spec: Place liberty submit action on the questioned group itself (tap the question mark on board). Needs onboarding UX to teach this interaction.

Spec: Blind mode — hide board and let user mentally replay the sequence. Optionally require re-entering the move sequence as a quiz phase (before or after liberty questions).

Spec: Compute a difficulty score per problem (e.g., move count, board complexity, liberty ranges, group count).

Spec: Add back comparative question mode — "which group has more liberties?" User taps one of two highlighted groups. Reduces clicking tedium for high-liberty groups.

Spec: Mid-quiz replay — allow reviewing the move sequence while answering liberty questions without resetting progress.

## Can implement now

Spec: Suppress haptic feedback on long-press on go stones gesture.

Spec: In review mode, tap a group to toggle liberty display on/off (replace current hold-to-show).

Spec: Replay must be a temporary overlay. Exiting replay restores the original finished state (engine, scores, review markers) exactly as before replay started.

Spec: Minimize Shudan board padding/borders to maximize board size on screen. Rotate the board if needed.

Spec: Auto-rotate board 90 degrees when the problem fits.

Spec: Show a back-to-library button on the finished/scores screen.

Spec: Add a "Retry" button on the finished screen to re-attempt the same problem.
