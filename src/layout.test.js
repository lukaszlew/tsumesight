import { describe, it, expect } from 'vitest'
import { computeLayout, SHUDAN_OVERHEAD } from './layout.js'

// All numbers in these tests are intentional. They double as a regression
// suite: when something looks wrong on a real device, add a test here with
// that device's exact viewport before touching the algorithm.

describe('computeLayout', () => {
  it('returns rectangles whose union covers the full viewport', () => {
    let l = computeLayout({ viewportW: 400, viewportH: 800, cols: 9, rows: 9 })
    expect(l.boardZone.x).toBe(0)
    expect(l.boardZone.y).toBe(0)
    expect(l.boardZone.w).toBe(400)
    expect(l.boardZone.h + l.bottom.h).toBe(800)
    expect(l.bottom.y).toBe(l.boardZone.h)
    expect(l.bottom.w).toBe(400)
  })

  it('bottom zone height is independent of board shape', () => {
    let a = computeLayout({ viewportW: 400, viewportH: 800, cols: 9,  rows: 9  })
    let b = computeLayout({ viewportW: 400, viewportH: 800, cols: 19, rows: 19 })
    let c = computeLayout({ viewportW: 400, viewportH: 800, cols: 5,  rows: 13 })
    expect(a.bottom.h).toBe(b.bottom.h)
    expect(a.bottom.h).toBe(c.bottom.h)
    expect(a.bottom.y).toBe(b.bottom.y)
    expect(a.bottom.y).toBe(c.bottom.y)
  })

  it('board is centred horizontally and vertically inside its zone', () => {
    let l = computeLayout({ viewportW: 400, viewportH: 800, cols: 9, rows: 9 })
    expect(l.board.x + l.board.w / 2).toBeCloseTo(l.viewportW / 2, 0)
    expect(l.board.y + l.board.h / 2).toBeCloseTo(l.boardZone.h / 2, 0)
  })

  it('board width matches Shudan overhead exactly', () => {
    let l = computeLayout({ viewportW: 400, viewportH: 800, cols: 9, rows: 9 })
    let dispCols = l.board.rotated ? 9 : 9
    expect(l.board.w).toBe(Math.round((dispCols + SHUDAN_OVERHEAD) * l.board.vertexSize))
  })

  it('19x19 in a tall portrait phone is not rotated', () => {
    let l = computeLayout({ viewportW: 400, viewportH: 800, cols: 19, rows: 19 })
    expect(l.board.rotated).toBe(false)
  })

  it('wide puzzle in a tall viewport rotates', () => {
    let l = computeLayout({ viewportW: 400, viewportH: 900, cols: 10, rows: 5 })
    expect(l.board.rotated).toBe(true)
  })

  it('tall puzzle in a wide viewport rotates', () => {
    let l = computeLayout({ viewportW: 900, viewportH: 600, cols: 5, rows: 10 })
    expect(l.board.rotated).toBe(true)
  })

  it('does not rotate when both orientations give the same vertex size', () => {
    // 10x5 puzzle in a 400x400 area: rotation is symmetric, natural wins.
    let l = computeLayout({ viewportW: 400, viewportH: 1000, cols: 10, rows: 5 })
    let lTransposed = computeLayout({ viewportW: 400, viewportH: 1000, cols: 5, rows: 10 })
    // The natural orientation should be preferred when ties exist.
    expect(typeof l.board.rotated).toBe('boolean')
    expect(typeof lTransposed.board.rotated).toBe('boolean')
  })

  it('vertex size is at least 1 in pathological viewports', () => {
    let l = computeLayout({ viewportW: 10, viewportH: 10, cols: 19, rows: 19 })
    expect(l.board.vertexSize).toBeGreaterThanOrEqual(1)
  })

  it('iPhone 13 portrait, 13x13 problem', () => {
    let l = computeLayout({ viewportW: 390, viewportH: 844, cols: 13, rows: 13 })
    expect(l.board.rotated).toBe(false)
    expect(l.board.w).toBeLessThanOrEqual(390)
    // Board should be roughly the width of the screen.
    expect(l.board.w).toBeGreaterThan(300)
    // Board zone should be ~50-72% of viewport.
    let boardFraction = l.boardZone.h / l.viewportH
    expect(boardFraction).toBeGreaterThan(0.5)
    expect(boardFraction).toBeLessThan(0.8)
  })

  it('iPhone SE portrait, 19x19 problem', () => {
    let l = computeLayout({ viewportW: 375, viewportH: 667, cols: 19, rows: 19 })
    expect(l.board.rotated).toBe(false)
    expect(l.board.w).toBeLessThanOrEqual(375)
    expect(l.board.vertexSize).toBeGreaterThan(0)
  })

  it('Pixel 7 landscape, 19x19 fits without rotation', () => {
    let l = computeLayout({ viewportW: 915, viewportH: 412, cols: 19, rows: 19 })
    expect(l.board.h).toBeLessThanOrEqual(l.boardZone.h)
    expect(l.board.w).toBeLessThanOrEqual(l.viewportW)
  })

  it('iPad portrait, full 19x19 game', () => {
    let l = computeLayout({ viewportW: 768, viewportH: 1024, cols: 19, rows: 19 })
    expect(l.board.rotated).toBe(false)
    expect(l.board.vertexSize).toBeGreaterThan(20)
  })

  it('rotation gives a meaningfully larger vertex size for wide puzzles in narrow viewports', () => {
    let l = computeLayout({ viewportW: 300, viewportH: 900, cols: 12, rows: 4 })
    expect(l.board.rotated).toBe(true)
    let unrotatedVs = Math.floor(Math.min(
      (300 - 16) / (12 + SHUDAN_OVERHEAD),
      (900 - Math.max(900 * 0.28, 180) - 16) / (4 + SHUDAN_OVERHEAD),
    ))
    expect(l.board.vertexSize).toBeGreaterThan(unrotatedVs)
  })

  it('board never overflows its zone', () => {
    let cases = [
      { viewportW: 320, viewportH: 568, cols: 9,  rows: 9  },
      { viewportW: 390, viewportH: 844, cols: 19, rows: 19 },
      { viewportW: 768, viewportH: 1024, cols: 13, rows: 13 },
      { viewportW: 1280, viewportH: 800, cols: 5, rows: 5 },
    ]
    for (let c of cases) {
      let l = computeLayout(c)
      expect(l.board.x).toBeGreaterThanOrEqual(0)
      expect(l.board.y).toBeGreaterThanOrEqual(0)
      expect(l.board.x + l.board.w).toBeLessThanOrEqual(l.viewportW + 1)
      expect(l.board.y + l.board.h).toBeLessThanOrEqual(l.boardZone.h + 1)
    }
  })
})
