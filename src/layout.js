// Single source of truth for the quiz screen's geometry.
//
// Pure function: no DOM reads, no side effects, no React. Inputs in →
// rectangles out. To debug a layout bug, log the result of computeLayout
// and reproduce in src/layout.test.js with the same numbers.
//
// All values are in CSS pixels. Coordinates are relative to the .quiz
// container's top-left (which itself fills the visual viewport).

// Shudan's per-axis overhead: .15em border + .25em padding on each side,
// with fontSize = vertexSize. So 2 * (0.15 + 0.25) = 0.8 em per axis.
// This must match the actual @sabaki/shudan CSS or the board overflows
// or under-fills its slot.
export const SHUDAN_OVERHEAD = 0.8

// Reservation for the bottom zone (tip + buttons). The zone is always
// this tall regardless of how many buttons are currently rendered, so
// the board never moves when controls toggle in/out.
//
// Fraction of viewport height + an absolute floor. The floor matters on
// short landscape phones; the fraction matters on tall portrait phones.
const BOTTOM_FRACTION = 0.28
const BOTTOM_MIN_PX   = 180

// Visual breathing room around the board within its zone.
const BOARD_PADDING = 8

export function computeLayout({ viewportW, viewportH, cols, rows }) {
  let bottomH = Math.round(Math.max(viewportH * BOTTOM_FRACTION, BOTTOM_MIN_PX))
  // Don't let the bottom zone eat the entire screen on tiny viewports.
  bottomH = Math.min(bottomH, Math.floor(viewportH * 0.6))

  let boardZone = {
    x: 0,
    y: 0,
    w: viewportW,
    h: viewportH - bottomH,
  }

  let availW = boardZone.w - 2 * BOARD_PADDING
  let availH = boardZone.h - 2 * BOARD_PADDING

  // Try both orientations. "rotated" means we display the puzzle
  // transposed (rows ↔ cols). Pick whichever gives a larger vertex.
  // Use strict > so the natural orientation wins ties.
  let vsFor = (c, r) => Math.floor(Math.min(
    availW / (c + SHUDAN_OVERHEAD),
    availH / (r + SHUDAN_OVERHEAD),
  ))
  let vsNormal  = vsFor(cols, rows)
  let vsRotated = vsFor(rows, cols)
  let rotated   = vsRotated > vsNormal
  let vertexSize = Math.max(1, rotated ? vsRotated : vsNormal)

  let dispCols = rotated ? rows : cols
  let dispRows = rotated ? cols : rows
  let boardW = Math.round((dispCols + SHUDAN_OVERHEAD) * vertexSize)
  let boardH = Math.round((dispRows + SHUDAN_OVERHEAD) * vertexSize)

  let board = {
    x: boardZone.x + Math.round((boardZone.w - boardW) / 2),
    y: boardZone.y + Math.round((boardZone.h - boardH) / 2),
    w: boardW,
    h: boardH,
    vertexSize,
    rotated,
  }

  let bottom = {
    x: 0,
    y: viewportH - bottomH,
    w: viewportW,
    h: bottomH,
  }

  return { viewportW, viewportH, boardZone, board, bottom }
}
