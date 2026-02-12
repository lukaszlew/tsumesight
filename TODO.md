# TODO

- Handle multiple variations through DFS and undo

## Visual error feedback (non-blocking)
When the player answers incorrectly, show a brief non-blocking visual cue — e.g., red flash on the board border, answer button shake, or a red tint that fades. Should happen on every wrong answer without blocking interaction. Separate from the one-time retry-hint modal.

## Ask about groups with fewer liberties first
In liberty mode, sort questions so groups with smaller liberty counts are asked first (1-liberty before 2-liberty, etc.). Currently ordered by a scoring heuristic. This prioritizes the most tactically critical groups. Open question: how to balance question distribution across moves while keeping the average questions per move stable.

## Show all stones with move numbers on mistake
When the player answers wrong and all hidden stones are revealed (`_saveAndMaterialize`), display each revealed stone's move number as a label on the board. Currently stones are revealed without numbers. Revealed stones should look identical to the one stone showed on each move.

## Permanently reveal some stones on repeated mistakes
After a mistake, permanently reveal 2, 4, or 6 stones (scaling with error count) so they stay visible for the rest of the problem. Adaptive difficulty — more mistakes means more help. Reveal the oldest hidden stones first. Exact count-per-mistake TBD.

## End-of-problem variation review
On the stats screen, show the full variation with all stones and move numbers immediately. Provide stepping buttons (forward/back) to walk through one move at a time. When stepping reaches the end, pressing forward restarts from the beginning.

## Mode selection per problem instead of persistent config
Replace the liberty/comparison mode toggle in the gear menu with a mode choice shown before each problem starts (two buttons: "Liberty" / "Comparison"). Remove mode from settings. Choice applies to current problem only.

## Better button layout for mobile
The "1" button in liberty mode is too close to the phone edge — hard to reach with thumb ("Q" in comparison mode is fine). Add more horizontal margin. Consider a 2-row layout (row 1: 1–3, row 2: 4–5+) or centering further from edges. Add bottom margin equal to a full button height.

## Cap question time at 5s for scoring
Cap each question's recorded time at 5 seconds in the stats. Times above 5s count as 5s. A move with 2 questions has a max scoring time of 15s (5s show + 5s + 5s). The cap only affects stats display, not gameplay.

## High score table
Persistent high scores to motivate beating records. Track per-problem: best accuracy %, best average time (in ms), date achieved. Show on stats screen after completing a problem and in the library listing. Display all times in milliseconds.

## Per-move time chart
After completing a problem, show a bar chart with one bar per question and one bar for the move-viewing time (how long the user looked at the stone before questions started — in manual mode this is measured, in timed mode it's the configured duration like 0.5s or 0.2s). Move bars use a distinct color from question bars. Allow comparison across attempts — overlay current run against best previous run of the same problem.

## Make ghost stone opaque with move number
During show phase, change the semi-transparent ghost stone to a normal opaque stone with the move number label. Should look like a regular placed stone, just numbered.

## Skip unchanged comparison pairs
In comparison mode, if two groups were compared in a previous move and neither group's liberty count changed since then, skip that pair. Only ask about pairs where at least one group's liberties changed. (Partially implemented via `libsChanged` — verify and strengthen.)

## PWA install support
Add `manifest.json` (app name, icons, theme color, `display: standalone`) and a service worker for offline caching. Enables "Add to Home Screen" on mobile and "Install" on desktop Chrome.

## Browser history and swipe navigation
Browser back/forward buttons should navigate between library and quiz views (`pushState`/`popstate`). On mobile, swipe gestures for previous/next problem within the quiz.

## Softer high-pitched sounds
Correct-answer sounds get progressively higher on streaks, becoming piercing. Options: reduce volume at higher pitches, cap the maximum frequency, or use a Shepard tone (illusion of endlessly rising pitch without actually getting higher).
