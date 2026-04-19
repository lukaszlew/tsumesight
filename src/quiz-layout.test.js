import { describe, it, expect } from 'vitest'
import { pickBoardLayout } from './quiz-board.jsx'

describe('pickBoardLayout', () => {
  it('keeps a square 19x19 unrotated in a square area', () => {
    let { rotated, vertexSize } = pickBoardLayout(600, 600, 19, 19)
    expect(rotated).toBe(false)
    expect(vertexSize).toBeGreaterThan(0)
  })

  it('rotates a wide puzzle in a tall area', () => {
    // 10 cols x 5 rows puzzle, tall narrow viewport
    let { rotated } = pickBoardLayout(400, 700, 10, 5)
    expect(rotated).toBe(true)
  })

  it('rotates a tall puzzle in a wide area', () => {
    // 5 cols x 10 rows puzzle, wide short viewport
    let { rotated } = pickBoardLayout(700, 400, 5, 10)
    expect(rotated).toBe(true)
  })

  it('does NOT rotate when the available area is square', () => {
    // Equal dimensions — both orientations give the same vertex size,
    // so the heuristic should keep the natural orientation. (This is the
    // regression that the aspect-ratio:1 board-row CSS introduced.)
    let { rotated } = pickBoardLayout(400, 400, 10, 5)
    expect(rotated).toBe(false)
  })

  it('does NOT rotate when puzzle aspect already matches', () => {
    // Wide puzzle, wide area
    let { rotated } = pickBoardLayout(800, 400, 10, 5)
    expect(rotated).toBe(false)
  })

  it('rotation gives a meaningfully larger vertex size', () => {
    // Wide puzzle (12x4) in a tall narrow viewport
    let normal = pickBoardLayout(300, 900, 12, 4)
    let rotatedSize = Math.floor(Math.min(300 / 4.5, 900 / 12.5))
    expect(normal.rotated).toBe(true)
    expect(normal.vertexSize).toBe(rotatedSize)
  })

  it('returns at least 1 for vertex size in pathological cases', () => {
    let { vertexSize } = pickBoardLayout(1, 1, 19, 19)
    expect(vertexSize).toBeGreaterThanOrEqual(1)
  })
})
