import { describe, it, expect } from 'vitest'
import { siblings, stepSibling, nextUnsolved } from './navigation.js'

function mk(id, filename, path, extra = {}) {
  return { id, filename, path, moveCount: 1, uploadedAt: id * 100, solved: false, ...extra }
}

describe('siblings', () => {
  it('filters by cwd and sorts by uploadedAt then filename', () => {
    let sgfs = [
      mk(1, 'b.sgf', 'foo', { uploadedAt: 100 }),
      mk(2, 'a.sgf', 'foo', { uploadedAt: 100 }),
      mk(3, 'c.sgf', 'bar', { uploadedAt: 100 }),
      mk(4, 'd.sgf', 'foo', { uploadedAt: 50 }),
    ]
    expect(siblings(sgfs, 'foo').map(s => s.id)).toEqual([4, 2, 1])
    expect(siblings(sgfs, 'bar').map(s => s.id)).toEqual([3])
    expect(siblings(sgfs, '').map(s => s.id)).toEqual([])
  })
})

describe('stepSibling', () => {
  it('cyclic next/prev', () => {
    let list = [mk(1, 'a'), mk(2, 'b'), mk(3, 'c')]
    expect(stepSibling(list, 1, 1).id).toBe(2)
    expect(stepSibling(list, 3, 1).id).toBe(1)   // wraps
    expect(stepSibling(list, 1, -1).id).toBe(3)  // wraps
    expect(stepSibling(list, 2, -1).id).toBe(1)
  })

  it('unknown currentId returns first', () => {
    let list = [mk(1, 'a'), mk(2, 'b')]
    expect(stepSibling(list, 99, 1).id).toBe(1)
  })

  it('empty list returns null', () => {
    expect(stepSibling([], 1, 1)).toBeNull()
  })
})

const noScore = () => ({ bestAccuracy: null, latestDate: 0 })

describe('nextUnsolved', () => {
  it('picks first unsolved after current', () => {
    let list = [mk(1, 'a', '', { solved: true }), mk(2, 'b', ''), mk(3, 'c', '')]
    expect(nextUnsolved(list, 1, noScore)).toEqual({ sgf: list[1], reason: 'unsolved' })
  })

  it('wraps past end', () => {
    let list = [mk(1, 'a', ''), mk(2, 'b', '', { solved: true }), mk(3, 'c', '', { solved: true })]
    expect(nextUnsolved(list, 3, noScore).sgf.id).toBe(1)
  })

  it('all solved → pick first imperfect (accuracy < 1)', () => {
    let list = [
      mk(1, 'a', '', { solved: true }),
      mk(2, 'b', '', { solved: true }),
    ]
    let scores = { 1: { bestAccuracy: 1, latestDate: 100 }, 2: { bestAccuracy: 0.8, latestDate: 200 } }
    let r = nextUnsolved(list, 1, id => scores[id])
    expect(r).toEqual({ sgf: list[1], reason: 'imperfect' })
  })

  it('all perfect → pick least-recently practiced', () => {
    let list = [
      mk(1, 'a', '', { solved: true }),
      mk(2, 'b', '', { solved: true }),
      mk(3, 'c', '', { solved: true }),
    ]
    let scores = {
      1: { bestAccuracy: 1, latestDate: 300 },
      2: { bestAccuracy: 1, latestDate: 100 },
      3: { bestAccuracy: 1, latestDate: 200 },
    }
    let r = nextUnsolved(list, 1, id => scores[id])
    expect(r).toEqual({ sgf: list[1], reason: 'least-recent' })
  })

  it('skips moveCount=0 problems', () => {
    let list = [mk(1, 'a', '', { moveCount: 0 }), mk(2, 'b', '', {})]
    expect(nextUnsolved(list, null, noScore).sgf.id).toBe(2)
  })

  it('empty list → null', () => {
    expect(nextUnsolved([], null, noScore)).toBeNull()
  })
})
