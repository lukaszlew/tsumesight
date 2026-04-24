import { describe, it, expect } from 'vitest'
import { init, step, phase } from './session.js'
import { derive } from './derive.js'
import { buildMaps, rotateMaps, orderGroupsByDisplay } from './display.js'

// dispatchAllAdvances helper (same shape as in session.test.js)
function advanceThroughShowing(s) {
  while (phase(s) === 'showing') step(s, { kind: 'advance' })
}

describe('display.js — buildMaps', () => {
  it('during showing phase: renders current move as labeled stone', () => {
    let s = init('(;SZ[9];B[ee])')
    step(s, { kind: 'advance' })  // show move 1
    let view = derive(s)
    let maps = buildMaps(view, s, { isFinished: false, showSeqStones: false })
    // Move is at [4,4] with label "1"
    expect(maps.signMap[4][4]).toBe(1)
    expect(maps.markerMap[4][4]).toEqual({ type: 'label', label: '1' })
    // Nothing painted
    expect(maps.paintMap[4][4]).toBe(0)
  })

  it('during exercise: renders user marks as labels', () => {
    let s = init('(;SZ[9];B[ee])')
    advanceThroughShowing(s)  // into exercise
    step(s, { kind: 'setMark', vertex: [4, 4], value: 3 })
    let view = derive(s)
    let maps = buildMaps(view, s, { isFinished: false, showSeqStones: false })
    expect(maps.markerMap[4][4]).toEqual({ type: 'label', label: '3' })
    expect(maps.paintMap[4][4]).toBe(0)  // no color yet
  })

  it('after wrong submit: user mark gains red paint', () => {
    let s = init('(;SZ[9];B[ee])', { maxSubmits: 2 })
    advanceThroughShowing(s)
    step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })  // wrong
    step(s, { kind: 'submit' })
    let view = derive(s)
    let maps = buildMaps(view, s, { isFinished: false, showSeqStones: false })
    expect(maps.markerMap[4][4]).toEqual({ type: 'label', label: '2' })
    expect(maps.paintMap[4][4]).toBe(-1)  // red
  })

  it('after correct submit: user mark gains green paint', () => {
    let s = init('(;SZ[9];B[ee])')
    advanceThroughShowing(s)
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })  // correct
    step(s, { kind: 'submit' })
    let view = derive(s)
    let maps = buildMaps(view, s, { isFinished: true, showSeqStones: false })
    expect(maps.paintMap[4][4]).toBe(1)  // green
  })
})

describe('display.js — rotateMaps', () => {
  it('transposes all four maps', () => {
    let m = {
      signMap: [[1, 2], [3, 4]],
      markerMap: [['a', 'b'], ['c', 'd']],
      ghostStoneMap: [[0, 0], [0, 0]],
      paintMap: [[1, 0], [0, -1]],
    }
    let r = rotateMaps(m)
    expect(r.signMap).toEqual([[1, 3], [2, 4]])
    expect(r.markerMap).toEqual([['a', 'c'], ['b', 'd']])
    expect(r.paintMap).toEqual([[1, 0], [0, -1]])
  })
})

describe('display.js — orderGroupsByDisplay', () => {
  it('orders by (x,y) in unrotated layout', () => {
    let groups = [
      { vertex: [2, 1] },
      { vertex: [0, 3] },
      { vertex: [1, 1] },
    ]
    expect(orderGroupsByDisplay(groups, false)).toEqual([1, 2, 0])
  })

  it('swaps axes when rotated=true', () => {
    let groups = [
      { vertex: [2, 1] },
      { vertex: [0, 3] },
      { vertex: [1, 1] },
    ]
    // Rotated: sort by (y, x) instead
    // (2,1) → (1,2), (0,3) → (3,0), (1,1) → (1,1)
    // Sorted: (1,1)=2, (1,2)=0, (3,0)=1
    expect(orderGroupsByDisplay(groups, true)).toEqual([2, 0, 1])
  })
})
