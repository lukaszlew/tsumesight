# TODO


- Cap the time chart Y-axis at 5000ms. Any bar exceeding 5s gets clipped to the top. This removes outliers that compress the useful range and make normal times unreadable.


- The correct-answer sound pitch increases with streak but the volume is fading out over consecutive plays. Keep volume constant regardless of streak length.


- The intro hint ("this stone will disappear") fires after moveIndex reaches 1, but it should fire only after the user presses Next/Space to advance past the first shown stone — not immediately when the stone appears.


- In comparison mode, the Q, =, and W buttons should all be the same width and have equal spacing between them.


- Remove the black-stone/white-stone gradient styling from Q and W buttons. Use A/B labels, and the stone that is on the left or above should be A.

- On the mode selection screen (liberty vs comparison), also show the questions-per-move selector (currently buried in settings). Let the user pick both mode and question count before starting. Update hints


- When the quiz is finished, the on-screen arrow buttons (prev/next) should step through the review instead of navigating to prev/next problem. Currently only keyboard arrows do review; the touch buttons still navigate away. The help overlay already documents arrows as review controls. change icons when change function. update "?" button and hints if needed


-  The Next button should be as wide as 2-3 buttons

- Update the wrong-answer hint to say all hidden stones are temporarily revealed. After a mistake, each advance shows 2 stones at a time instead of 1. After another mistake, 3 at a time, etc. This makes the problem easier by revealing more context per step.


- The time chart SVG is too small on mobile to read. The 5s cap (first item) should help with outliers. let's discuss resizing.


- The text stats line (accuracy, avg time, best score, run count) above the chart is too long and wraps poorly on narrow screens. Break it into multiple lines or use a compact layout with columns.


- Move the time chart from the top stats row (row 1) to below the answer buttons (rows 5-6 area) when the quiz is finished, so it doesn't compete with the board for vertical space.

- The move number labels on stones use Shudan's marker styling with `-webkit-text-stroke` which looks rough at small sizes. Use a cleaner rendering: different font.


## End-of-problem variation review
We need to fix buttons vs kbd keys, they are confusing.

## High score table
Persistent high scores to motivate beating records. Track per-problem: best accuracy %, best average time (in ms), date achieved. Show on stats screen after completing a problem and in the library listing. Display all times in milliseconds.

## Handle multiple variations through DFS and undo

## Imporove problem selection
