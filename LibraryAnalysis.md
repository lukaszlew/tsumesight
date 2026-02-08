# Library Analysis — Go Reading Trainer

## Decision: Sabaki Ecosystem

All three core dependencies come from the Sabaki project (2645 stars, 400 forks,
actively maintained desktop Go app). Using a single ecosystem reduces integration
risk and ensures the libraries are designed to work together.

## Game Logic: @sabaki/go-board

- **GitHub**: SabakiHQ/go-board — 26 stars, 11 forks, 3 contributors
- **npm**: 86 downloads/week
- **Size**: ~340 lines, 2 source files
- **Dependencies**: zero
- **License**: MIT
- **Last push**: Sep 2021
- **Battle-testing**: Low standalone stats, but powers Sabaki (2645 stars). Clean issue tracker (1 open / 4 closed).
- **Features**: Stone placement, capture detection (flood-fill), liberty counting (`getLiberties()`), simple ko, optional suicide prevention. Immutable API — `makeMove()` returns new board.
- **Missing**: Superko (not needed for spec), scoring (not needed).
- **API**:
  ```js
  let board = Board.fromDimensions(19)
  board = board.makeMove(1, [3, 3])      // 1=black, -1=white
  board.getLiberties([3, 3])              // [[3,2], [2,3], ...]
  board.getChain([3, 3])                 // connected stones
  board.analyzeMove(1, [3, 3])           // {pass, suicide, ko, capturing}
  board.get([3, 3])                      // 1, -1, or 0
  ```

### Alternatives considered

| Library | Stars | Forks | Deps | Superko | Vendorable | Why not |
|---------|-------|-------|------|---------|------------|---------|
| WGo.js | 333 | 123 | 0 | Yes | Moderate (extract from mixed file) | No license file on GitHub; 36 open issues; game logic tangled with rendering |
| Tenuki | 129 | 25 | 0 | Yes (Zobrist) | Moderate (extract from UI lib) | Dormant since 2021; 4 contributors; logic woven into UI |
| weiqi.js | 72 | 31 | immutable.js | Positional | Hard | Heavy dep (immutable.js ~60KB); dead since 2016 |
| godash | — | — | immutable+lodash | No | Hard | Two heavy runtime deps |

## SGF Parsing: @sabaki/sgf

- **GitHub**: SabakiHQ/sgf — 55 stars, 14 forks, 2 contributors
- **npm**: 181 downloads/week (highest of all SGF libs by 60x)
- **Size**: ~127KB unpacked (including tests)
- **Dependencies**: `doken` (tokenizer generator, ~19KB, zero deps itself)
- **License**: MIT
- **Last push**: Aug 2023
- **Battle-testing**: Powers Sabaki. Highest npm downloads among SGF libs.
- **Features**: Tokenizer/parser pipeline, stringify, vertex helpers, compressed point list expansion, encoding detection.
- **Malformed SGF**: Strict — throws on invalid tokens. However, the tokenizer/parser split architecture makes it feasible to add error recovery (catch at parser level, skip to next node).
- **API**:
  ```js
  let trees = sgf.parse(sgfString)       // returns game tree nodes
  let vertex = sgf.parseVertex("pd")     // [15, 3]
  ```

### Alternatives considered

| Library | Stars | npm/wk | Deps | Broken file handling | Why not |
|---------|-------|--------|------|---------------------|---------|
| SGFGrove | 12 | 3 | 0 | Strict, clear errors | Tiny community; dead since 2016; no tokenizer/parser split for recovery |
| smartgame | 22 | 3 | 0 | Silent garbage on bad input | Produces wrong output silently on malformed files; dead since 2017 |
| WGo.js SGF | (part of WGo) | — | 0 | Silent failures, fragile regex | Tangled with WGo internals; no license |

## Board Rendering: @sabaki/shudan (initial)

- **GitHub**: SabakiHQ/Shudan — used in Sabaki desktop app
- **npm**: @sabaki/shudan
- **Size**: ~827KB unpacked
- **Dependencies**: Preact (peer)
- **License**: MIT
- **Rendering**: CSS Grid + DOM vertices + SVG lines
- **Features**: Resizable boards, coordinates, markers, lines/arrows, heat maps, fuzzy stone placement, animation.
- **Plan**: Use initially to get quiz logic working fast. Replace later with custom SVG renderer for full control over spec requirements (invisible stones, diamond markers, numbered stones, materializing animation).

## Tooling

- **Bundler**: Vite — fast, zero-config Preact support, HMR dev server, `vite build` produces static output.
- **Framework**: Preact — required by Shudan, lightweight React alternative (~3KB).

## Data collected

Raw GitHub stats fetched 2026-02-08 via `tmp/github_stats.sh`.
