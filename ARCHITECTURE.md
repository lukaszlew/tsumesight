# Go Reading Trainer — Architecture

## Overview

Quiz app that plays through SGF game records and quizzes on invisible board state.
Stack: Preact + Vite + @sabaki/go-board + @sabaki/sgf + @sabaki/shudan

## File Structure

```
src/
  main.jsx              # Entry point, CSS imports
  app.jsx               # Router: Library ↔ Quiz
  library.jsx           # SGF library screen (IndexedDB)
  quiz.jsx              # Quiz screen (orchestrates everything)
  engine.js             # Pure quiz logic (no UI)
  sgf-utils.js          # SGF parsing helpers
  db.js                 # IndexedDB wrapper
  style.css             # Global styles
  sgf-utils.test.js     # SGF parsing tests
  engine.test.js        # Quiz engine tests
```

## Core Concept: Two Boards

The central design challenge is managing two board states:

- **True board** (`engine.trueBoard`): Full game state with all moves and captures
  processed correctly via @sabaki/go-board's `makeMove()`.
- **Display board** (`engine.baseSignMap` + current move overlay): What the user
  sees. Invisible stones are hidden; captured stones are intentionally NOT removed.

This separation simulates the mental reading challenge: the displayed board is
intentionally inconsistent with the true game state.

## Quiz Engine (`engine.js`)

Pure class, no UI dependencies. Key state:

- `trueBoard` — @sabaki/go-board Board, real game state
- `baseSignMap` — 2D array, what's displayed (mutable)
- `invisibleStones` — Map of stones on true board but not on display
- `moveIndex`, `currentMove`, `questionVertex` — current quiz state
- `correct`, `wrong`, `results` — scoring

Key methods:

- `advance()` — Play next move on trueBoard, track as invisible, pick question
- `answer(color, liberties)` — Evaluate answer, materialize on wrong
- `materialize()` — Copy all invisible stones to baseSignMap
- `getDisplaySignMap()` — Clone baseSignMap + overlay current move

## SGF Utilities (`sgf-utils.js`)

`parseSgf(sgfString)` returns `{ boardSize, moves, setupBlack, setupWhite,
playerBlack, playerWhite, moveCount }`. Walks main line only. Handles
compressed vertices (AB[aa:cc]) and pass moves (B[] or B[tt]).

## Quiz UI (`quiz.jsx`)

Maps engine state to Shudan `<BoundedGoban>` props:

- `signMap`: engine.getDisplaySignMap()
- `markerMap`: move number label on current move, point marker on question vertex
- Answer buttons: 4 liberty buttons (1, 2, 3, 4+) + 2 color buttons (Black, White)
- Auto-submits when both selections are made (no Submit button)
- Keyboard: 1-4 for liberties, q/w for color
- Wrong answer: highlights correct answers in green, then materializes

## Library (`library.jsx` + `db.js`)

IndexedDB stores SGF files with metadata (filename, boardSize, moveCount, players).
Library screen shows a table; clicking a row starts the quiz.
