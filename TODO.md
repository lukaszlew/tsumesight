# TODO


- Cap the time chart Y-axis at 5000ms. Any bar exceeding 5s gets clipped to the top. This removes outliers that compress the useful range and make normal times unreadable.


- The correct-answer sound volume is fading out over consecutive plays. Keep volume constant regardless of streak length.


- The intro hint ("this stone will disappear") should fire only after the user presses Next/Space to advance past the first shown stone — not immediately when the stone appears.


- In comparison mode, the Q, =, and W buttons should all be the same width and have equal spacing between them.


- Remove the black-stone/white-stone gradient styling from comparison buttons. Use A/B labels. A is the stone that is both more to the left and more above (unambiguous on a Go board).

- On the mode selection screen (liberty vs comparison), also show the questions-per-move selector (currently buried in settings). Let the user pick both mode and question count before starting. Update hints.


- When the quiz is finished, the on-screen ◀▶ buttons should step through the review instead of navigating to prev/next problem. Change their icons to indicate review mode (e.g. ⏪⏩ or similar). Currently only keyboard arrows do review; the touch buttons still navigate away. Update the help overlay and hints to match.


- The Next button should be ~60% of the button area width.

- After a wrong answer, hint says all hidden stones are temporarily revealed. Also increase the "show window": normally 1 new stone per advance, after first mistake show the new stone plus the previous one (2 visible), after another mistake show new + 2 previous (3 visible), etc. The overlap lets the player see recent context.


- Make the time chart bigger on mobile without changing bar sizes or grid row allocations. Use a taller SVG or scale it to fill available space.


- The text stats line (accuracy, avg time, best score, run count) above the chart is too long and wraps poorly on narrow screens. Break it into multiple lines or use a compact layout with columns.


- Move the time chart from the top stats row (row 1) to below the answer buttons (rows 5-6 area) when the quiz is finished, so it doesn't compete with the board for vertical space.

- The move number labels on stones use Shudan's marker styling with `-webkit-text-stroke` which looks rough at small sizes. Use a cleaner rendering: different font.


## End-of-problem variation review
We need to fix buttons vs kbd keys, they are confusing.

## High score table
Persistent high scores to motivate beating records. Track per-problem: best accuracy %, best average time (in ms), date achieved. Show on stats screen after completing a problem and in the library listing. Display all times in milliseconds.

## Handle multiple variations through DFS and undo

## Improve problem selection
