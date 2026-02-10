# Layout Notes

## Quiz Screen Structure (top to bottom)
1. **Progress bar (pips)** — move indicators
2. **Board** — Shudan goban
3. **Nav bar (sysbar)** — ☰, ◀▶, mode toggle, sound
4. **Answer buttons** — 1/=/2 (comparison) or 1-5 (liberty) or Next

## Mobile Portrait Layout (`@media (orientation: portrait)`)
- Uses `dvh` units: pips 10%, board 50%, nav 8%, buttons 10%
- All sections have `flex-shrink: 0` and `overflow: hidden`
- `#app` has `padding: 0`, `height: 100dvh`, `overflow: hidden`

## Vertex Size Computation (quiz.jsx)
- Portrait: `maxW = window.innerWidth`, `maxH = window.innerHeight * 0.50`
- Desktop: `maxW = Math.min(window.innerWidth - 32, 480)`, `maxH = maxW`
- Divisor uses `cols + 1.8` / `rows + 1.8` (not `+1`) to account for Shudan border (`.15em`) + padding (`.25em`) on each side
- Board-container is inside a flex `justify-content: center` parent — on first render it has no content, so **never read `el.offsetWidth` for sizing** (chicken-and-egg problem). Use window dimensions instead.

## Shudan Goban Overhead
- Border: `--shudan-board-border-width: .15em` (each side)
- Padding: `.25em` (each side, from `.shudan-goban:not(.shudan-coordinates)`)
- Total overhead ≈ `0.8 * vertexSize` per axis
- Board texture removed (`background-image: none` on `.shudan-goban-image`), using flat `--shudan-board-background-color: #dcb35c`

## Answer Buttons
- Fixed height (`4rem`) to prevent layout shifts when buttons change
- Empty `<div class="answer-buttons" />` rendered when quiz is finished
- "Next" pill button when move has 0 questions

## Ghost Stone (Current Move)
- `signMap[y][x] = 0` + `ghostStoneMap[y][x] = { sign, faint: true }`
- Has `shudan-sign_0` class (not `sign_1/-1`)
- Gray outline via CSS: `.shudan-vertex.shudan-sign_0 .shudan-ghost::before { outline: 2px solid #888 }`
- Ghost size overridden to `.88em`

## Board Labels (1/2 markers)
- Color: `#999` (gray) with `-webkit-text-stroke: .03em #000`
- Wood circle (`::before` on vertex) only on empty intersections (`shudan-sign_0`) to cover grid lines
- Labels on stones/ghost stones: transparent background (stone shows through)
- Same styling everywhere to avoid leaking hidden stone color info
