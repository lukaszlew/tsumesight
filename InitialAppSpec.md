
# Go Reading Trainer — Specification

## Overview

A static single-page web application that trains Go players to read ahead by playing through SGF game records and quizzing them on the invisible board state. No backend required.

## SGF Management

- User uploads `.sgf` files via a file picker.
- Uploaded files are stored persistently in the browser using IndexedDB.
- A library screen lists all stored SGFs showing: filename, board size, move count, player names (if available).
- User can delete SGFs from the library.
- Clicking an SGF starts the quiz on it.

## Board Display

- Rendered on an HTML canvas with a wooden board texture, grid lines, and star points.
- Supports 9×9, 13×13, and 19×19 boards (auto-detected from SGF `SZ` property, default 19).
- Stones are drawn with radial gradients (black and white) and subtle shadows.
- Setup stones from the SGF root node (`AB`, `AW`) are displayed as part of the initial base position.

## Quiz Flow

### Initialization

- The quiz starts from the SGF's initial position (setup stones, if any; otherwise empty board).
- This initial position is the **base position**.
- The main line of the SGF is the move sequence to quiz on.
- All counters and feedback are reset.

### Per-Move Cycle

1. The next move from the sequence is played on an internal **true board** (which tracks the real game state including all moves and captures).
2. The move's stone is added to the **invisible moves** list — it is not shown on the base position display.
3. Only the **current move** is displayed on the board, drawn on top of the base position with its move number inside the stone.
4. A **question intersection** is selected (see Question Selection below).
5. A red diamond marker is drawn on that intersection.
7. The user answers by clicking buttons (see User Input below).
8. The answer is evaluated (see Evaluation below).
9. the cycle advances immediately to the next move.
10. Pass moves are skipped automatically.

### Question Selection

- The marked intersection is always an **invisible stone** — a stone that exists on the true board but is not part of the base position.
- Among all invisible stones still alive (not captured) on the true board, one is selected randomly.
- Preference (future improvement): stones whose group liberty set changed since the last question about that group.

### User Input

There are two rows of buttons below the progress bar:

**Liberties row** — 4 buttons:
- 1 (keyboard: `1`)
- 2 (keyboard: `1`)
- 3 (keyboard: `1`)
- 4+ (keyboard: `1`)

**Color row** — 2 buttons:
- ● Black (keyboard: `q`)
- ○ White (keyboard: `w`)

"4+" means four or more liberties.

There is **no Submit button**. The answer is submitted automatically as soon as both a color and a liberty value are selected. The user can select them in any order.

### Evaluation

Both the color answer and the liberty answer must be correct for the move to count as **correct**.

**Correct answer:**
- A green checkmark pip is added to the feedback strip.
- The correct score counter increments.
- Advance to next move.

**Wrong answer** (incorrect selection or timeout):
- A red cross pip is added to the feedback strip.
- The wrong score counter increments.
- **All currently invisible stones materialize** — they are added to the base position display and removed from the invisible moves list. The base position now equals the true board state (minus captured stones, which remain visible on the base per the rule below).
- Correct answers are briefly highlighted in green on the buttons.
- Advance to next move.

### Captures

- When an invisible move captures stones on the true board, the captured stones are **not removed** from the base position display.
- The displayed board may therefore be inconsistent with the true game state. This is intentional — it simulates the confusion the player must resolve mentally during real games.
- Liberty calculations on the true board are always correct (captures are processed normally on the true board).

### End of Sequence

When all moves have been played, a summary overlay is shown:
- Total moves
- Correct count
- Wrong count
- Accuracy percentage
- A button to return to the library

## Top Bar (during quiz)

Displayed above the board:
- **Move counter**: "Move X / Y"
- **Score**: "✓ N" (green) and "✗ N" (red)

## Feedback Strip

A row of small square pips below the answer buttons, one per answered move:
- Green pip with ✓ for correct
- Red pip with ✗ for wrong

## Technology

- Single HTML file with embedded CSS and JavaScript.
- SVG rendering for the board.
- IndexedDB for persistent SGF storage.
- No backend, no build step. Deployable as a static file.

## SGF Parsing

- SGF library

## Future Considerations (not in v1)

- Preference for questioning stones whose liberties changed with the last move.
- Variation selection (quiz on branches, not just main line).
- Configurable time limit.
- Aggregate time statistics and history.
- Embedding SGF files directly in the HTML for easy sharing.
