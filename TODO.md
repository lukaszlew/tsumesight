# TODO

## Skip for now

Spec: Support branched SGF trees. Traverse variations via DFS, allow undo to explore alternate lines.

Spec: Cross-device sync for library and scores (e.g., cloud storage, export/import, or sync protocol).

Spec: Blind mode — starts from initial position, user guesses moves similar to liberty guessing. Needs experimentation to find the right format.

Spec: Difficulty heuristic — primary factor is move count, secondary is number of small-liberty small groups. Needs experimentation. Display on tiles for now.

Spec: In order to emulate approach move in semeai, user should be able  to volunteer a sequence of one color of moves and then calculate the liberties of our resulting group. With opponent sometimes answering, according to fixed heuristics.

- Improve the algorithm for comparative question selection.
- Add some heuristics for connected groups and count their liberties together
- Let's try to add option where we present numbers (on intersections)
- We should not be asking about the same group too many times. matching instead of spanning tree.
- We should probably start on simplifying the code and formalizing the framework.
- We should mix up all the problems and start by difficulty.
- Number of questions should be proportional to number of moves.

## Spec-ed, can start working

## To spec


- When all problems are solved then we click next, we should choose the problem we didn't solve for the longest time in the dir.

- Draw equal just next to X and Z so they form a "triangle". Ideally below the left sign (Z) or to the right of the left of the top sign (Z).

- When the problem is solved there should be show/hide toggle that modifies whether additional stones are visible.

- Don't show the first move. user have to click to see it just like all other moves. but the time should started and included in the final score

- Back gesture should go back to menu like Escape instead of going to previous screen. Also dir up.

- My installed app should remember whether whether I was in pr production or development mode.

- When we open the app, we should no be in the problem, but in the dir where we had last problem or the dir we left.

- The final chord on finishing the puzzle should start with the note of the final question so they produce nice harmony together. There should be crescendo when we Mark continuous liberties (but undo when we unmark). But we should drop back when we get to next question of liberties.

- Fonts on mobile have strange outline problem, I'll show you screenshot when you ask.

- Recording is messed up in the way the answers are classified incorrectly when there is a playback. even though in the game they were classified correctly.

- Pips and hint text should be 2x bigger.

- When tapping a question pip or marker, all the other markers of other questions should disappear.

- When watching replay  we should have a timer and the progress bar.

- Is the last answer visible on replay? It should pause at the end with visibility.

- Incorrect answer on comparison is showing green and gray still.

- When entering the directory we should see the same tile at the top. We used to enter it except maybe in a different color.

- Playing under the stone (where there was a stone on original board) renders incorrectly

- Replay should also have sounds of stones being played and in general should share the same structure in code.

- During replay you should be able to restart the replay as well, so that button should be visible.


## Done

Spec: Remove per-move liberty mode — only liberty-end mode remains (questions after all moves placed). Remove the `mode` constructor parameter, `kv('quizMode')` setting, and all per-move code paths from engine/quiz/tests.

Spec: Progress pips — row directly below board, one per question (❓ for liberty, Z/X for comparison). Blue while pending, green/red after answering (left-to-right). Tappable only when finished: liberty pip toggles liberty review on that group (same as tapping stone); comparison pip shows Z/X labels with green letter (correct) or red letter (wrong) on gray stones.

Spec: Sound toggle — always-visible on/off button next to Back button in bottom bar.

Spec: Blue board markers — ❓, Z, X labels and = marker on board all blue. Next button blue (both in library and finished screen). Replay button stays gray. Other buttons unchanged.

Spec: Change comparison to "which group has LESS liberties". User taps the weaker group. Style "less" in blue in hint text.

Spec: Equal on board — find an empty edge intersection (or any intersection at distance ≥2 from all questioned vertices) to display blue =. Same intersection for the whole problem. User taps it for equal answer. Remove bottom-bar Equal button. Space key still works.

Spec: Button visibility — Back and Sound always visible in all states. Replay Sequence visible during questions (already preserves marks/timer). Retry only after finishing.

Spec: Stone placement sound — play a stone-click sound (random variation) when revealing each new move.


Spec: Fix sound not playing — playTone/playComplete checked `enabled` (starts null/falsy) instead of `getEnabled()`. Sound now works on first play without needing a toggle first.

Spec: Fix clicking ❓ stone marking a liberty at that position. Now clicking ❓ submits if marks exist, otherwise does nothing.

Spec: Fix Mark as solved button unreachable — showingMove phase was hiding preSolve buttons. Now shows both advance hint and Back/Mark as solved during showingMove.

Spec: Increase action hint font size (~2x) and add whitespace between hint text and buttons below.

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
