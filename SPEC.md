# TsumeSight — Specification

Go reading trainer. Plays through SGF game records, hides stones after showing them briefly, then quizzes on board state (liberty counting). Goal: train board visualization and reading.

## Core Loop

1. **Show phase**: Each move is played on the board and shown momentarily (manual advance or timed: 1s/0.5s/0.2s). After viewing, the stone disappears — the player must remember its position.

2. **Quiz phase** (last move only): After all moves are played, groups whose vertex-set or liberty-set changed from the initial position are selected as questions. A group is marked with "?" — the player picks its liberty count (1–4 or 5+).

3. **Wrong answer**: The chosen button is blocked (strikethrough, disabled). Player must pick again. Each error adds a 5s penalty to total time. Wrong answers also expand the "show window" — during subsequent show phases, more recent stones remain visible.

4. **Completion**: Shows total time (sum of answer times + 5s per error), best score, run number. Board reveals all stones with move numbers. Review mode lets the player step through moves and questions with arrow keys.

## Scoring

- Total time = sum of answer durations + 5s × error count
- Per-problem scores stored in IndexedDB: accuracy, average answer time, total time, error count, date, mode
- Best score shown on completion and in library listing

## SGF Library

- Upload SGF files or ZIP archives from local files or URL
- Files organized in a directory tree with breadcrumb navigation
- Each file shows: name, player names (B vs W), best score
- Directory rows show solved/total count
- Problems persist in IndexedDB

## Board Display

- Uses Shudan Goban component with wooden board styling
- Board is cropped to the bounding box of all stones/moves (with 1-cell padding), not full 19×19
- Vertex size computed from container via ResizeObserver
- Peek mode: hold "?" key or touch board to reveal hidden stones as ghost stones

## Layout

Six-row grid filling viewport height:
1. Stats bar (when finished) or empty
2. Board (Shudan Goban)
3. Problem name (directory + filename)
4. Top bar (menu, restart, review nav, prev/next, settings, help)
5–6. Bottom bar: answer buttons (1–5), next button, or start button

Summary panel appears beside the board on completion (retry, next unsolved, review stepper).

## Session Persistence

Quiz progress (answer history) saved to IndexedDB kv store keyed by `quizKey` (sgfId + mode + maxQ). On reload, the engine replays the saved history to restore state. Clearing happens on retry.

## Engine

- `QuizEngine` class: pure logic, no UI
- Seeded PRNG (mulberry32, seed = hash of SGF string) for deterministic question selection
- Immutable board updates via `@sabaki/go-board`
- Precomputes question counts per move via simulation (for progress tracking)
- Tracks invisible stones, staleness, previous liberty sets
- `fromReplay()` static method reconstructs engine state from answer history

## Tech Stack

- Preact + Vite (SPA, GitHub Pages deploy)
- `@sabaki/go-board` — board logic (immutable moves, liberty counting)
- `@sabaki/sgf` — SGF parsing
- `@sabaki/shudan` — board rendering (Goban component)
- IndexedDB — SGF storage and scores
- No server, no build-time dependencies beyond Vite
