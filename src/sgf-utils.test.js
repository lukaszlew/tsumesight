import { describe, it, expect } from 'vitest'
import { parseSgf } from './sgf-utils.js'

// Minimal SGF: 9x9, 3 moves, no setup
let simpleSgf = '(;SZ[9]PB[Alice]PW[Bob];B[ee];W[ce];B[gc])'

// SGF with setup stones
let setupSgf = '(;SZ[9]AB[dd][ed]AW[de][ee];B[cd];W[ce])'

// SGF with a pass move
let passSgf = '(;SZ[9];B[ee];W[];B[dd])'

// SGF with compressed vertices (rectangle)
let compressedSgf = '(;SZ[9]AB[aa:cc];B[ee])'

describe('parseSgf', () => {
  it('parses board size', () => {
    let result = parseSgf(simpleSgf)
    expect(result.boardSize).toBe(9)
  })

  it('defaults board size to 19', () => {
    let result = parseSgf('(;PB[X];B[dd])')
    expect(result.boardSize).toBe(19)
  })

  it('extracts player names', () => {
    let result = parseSgf(simpleSgf)
    expect(result.playerBlack).toBe('Alice')
    expect(result.playerWhite).toBe('Bob')
  })

  it('extracts moves with correct signs and vertices', () => {
    let result = parseSgf(simpleSgf)
    expect(result.moves).toEqual([
      { sign: 1, vertex: [4, 4] },
      { sign: -1, vertex: [2, 4] },
      { sign: 1, vertex: [6, 2] },
    ])
    expect(result.moveCount).toBe(3)
  })

  it('extracts setup stones', () => {
    let result = parseSgf(setupSgf)
    expect(result.setupBlack).toEqual([[3, 3], [4, 3]])
    expect(result.setupWhite).toEqual([[3, 4], [4, 4]])
  })

  it('handles pass moves', () => {
    let result = parseSgf(passSgf)
    expect(result.moves).toEqual([
      { sign: 1, vertex: [4, 4] },
      { sign: -1, vertex: null },
      { sign: 1, vertex: [3, 3] },
    ])
  })

  it('handles compressed vertex lists', () => {
    let result = parseSgf(compressedSgf)
    // aa:cc = 3x3 rectangle: [0,0] [1,0] [2,0] [0,1] [1,1] [2,1] [0,2] [1,2] [2,2]
    expect(result.setupBlack.length).toBe(9)
    expect(result.setupBlack).toContainEqual([0, 0])
    expect(result.setupBlack).toContainEqual([2, 2])
  })

  it('throws on empty input', () => {
    expect(() => parseSgf('')).toThrow()
  })

  it('follows first move-bearing child when children[0] is comment-only (Maeda format)', () => {
    // Maeda-style: root has setup, children[0] is comment-only, children[1] has moves
    let maedaSgf = '(;SZ[19]AB[dj][dk]AW[bk][ck](;C[Problem description])(;B[aj];W[ag];B[ai]))'
    let result = parseSgf(maedaSgf)
    expect(result.moveCount).toBe(3)
    expect(result.moves[0]).toEqual({ sign: 1, vertex: expect.any(Array) })
  })
})
