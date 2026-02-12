# TODO

## 3 - Browser history and swipe navigation
Browser back/forward buttons should navigate between library and quiz views (`pushState`/`popstate`). On mobile, swipe gestures for previous/next problem within the quiz.

## 3 - End-of-problem variation review
On the stats screen, show the full variation with all stones and move numbers immediately. Provide stepping buttons (forward/back) to walk through one move at a time. When stepping reaches the end, pressing forward restarts from the beginning.

## 3 - High score table
Persistent high scores to motivate beating records. Track per-problem: best accuracy %, best average time (in ms), date achieved. Show on stats screen after completing a problem and in the library listing. Display all times in milliseconds.

## 3 - Permanently reveal some stones on repeated mistakes
After a mistake, permanently reveal 2, 4, or 6 stones (scaling with error count) so they stay visible for the rest of the problem. Adaptive difficulty — more mistakes means more help. Reveal the oldest hidden stones first. Exact count-per-mistake TBD.

## 4 - Per-move time chart
After completing a problem, show a bar chart with one bar per question and one bar for the move-viewing time (how long the user looked at the stone before questions started — in manual mode this is measured, in timed mode it's the configured duration like 0.5s or 0.2s). Move bars use a distinct color from question bars. Allow comparison across attempts — overlay current run against best previous run of the same problem.

## 5 - Handle multiple variations through DFS and undo
