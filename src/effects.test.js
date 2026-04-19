import { describe, it, expect } from 'vitest'
import { init, step, phase } from './session.js'
import { sideEffectsFor, computeFinalizeData } from './effects.js'

function advanceThroughShowing(s) {
  while (phase(s) === 'showing') step(s, { kind: 'advance' })
}

describe('sideEffectsFor — per-event effects', () => {
  it('advance that stays in showing → sound/stoneClick', () => {
    let s = init('(;SZ[9];B[ee];W[aa];B[fe])')
    let evt = { kind: 'advance', t: 0 }
    step(s, evt)
    // cursor=1, still showing (2 more moves + activate-exercise)
    let effects = sideEffectsFor(s, evt)
    expect(effects).toEqual([{ kind: 'sound/stoneClick' }])
  })

  it('advance that activates exercise → no sound', () => {
    let s = init('(;SZ[9];B[ee])')
    step(s, { kind: 'advance' })  // show move 1
    let evt = { kind: 'advance', t: 0 }
    step(s, evt)  // activate exercise
    // phase now 'exercise', not 'showing'
    let effects = sideEffectsFor(s, evt)
    expect(effects).toEqual([])
  })

  it('setMark → sound/mark with value', () => {
    let s = init('(;SZ[9];B[ee])')
    advanceThroughShowing(s)
    let evt = { kind: 'setMark', vertex: [4, 4], value: 3, t: 0 }
    step(s, evt)
    let effects = sideEffectsFor(s, evt)
    expect(effects).toEqual([{ kind: 'sound/mark', value: 3 }])
  })

  it('wrong submit (non-finalizing) → sound/wrong + wrongFlash + cooldown', () => {
    let s = init('(;SZ[9];B[ee])', { maxSubmits: 2 })
    advanceThroughShowing(s)
    step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })
    let evt = { kind: 'submit', t: 0 }
    step(s, evt)
    let effects = sideEffectsFor(s, evt)
    // 3 s per counted mistake; 1 wrong group → 3 s.
    expect(effects).toEqual([
      { kind: 'sound/wrong' },
      { kind: 'wrongFlash' },
      { kind: 'cooldown', seconds: 3 },
    ])
  })

  it('cooldown scales as 3 × N (any non-correct group counts)', () => {
    let s = init('(;SZ[9];B[ee];W[aa];B[fe])', { maxSubmits: 3 })
    advanceThroughShowing(s)
    for (let g of s.engine.libertyExercise.groups.filter(g => g.changed)) {
      step(s, { kind: 'setMark', vertex: g.vertex, value: 1 })
    }
    let evt = { kind: 'submit', t: 0 }
    step(s, evt)
    let effects = sideEffectsFor(s, evt)
    let cooldown = effects.find(e => e.kind === 'cooldown')
    let nonCorrect = s.submitResults.at(-1).filter(r => r.status !== 'correct').length
    expect(cooldown).toEqual({ kind: 'cooldown', seconds: 3 * nonCorrect })
  })

  it('correct submit (finalizing) → sound/correct + onProgress', () => {
    let s = init('(;SZ[9];B[ee])')
    advanceThroughShowing(s)
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })
    let evt = { kind: 'submit', t: 0 }
    step(s, evt)
    let effects = sideEffectsFor(s, evt)
    expect(effects).toContainEqual({ kind: 'sound/correct' })
    expect(effects).toContainEqual({ kind: 'onProgress', correct: 1, done: 1, total: 1 })
  })

  it('force-commit after maxSubmits with wrong → sound/wrong + onProgress', () => {
    let s = init('(;SZ[9];B[ee])', { maxSubmits: 2 })
    advanceThroughShowing(s)
    step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })
    step(s, { kind: 'submit' })  // submit 1: wrong
    let evt = { kind: 'submit', t: 0 }
    step(s, evt)  // submit 2: force-commit
    let effects = sideEffectsFor(s, evt)
    expect(effects).toContainEqual({ kind: 'sound/wrong' })
    expect(effects).toContainEqual({ kind: 'onProgress', correct: 0, done: 1, total: 1 })
  })
})

describe('computeFinalizeData', () => {
  it('produces scoreEntry, replayPayload, popupData for a solved session', () => {
    let s = init('(;SZ[9];B[ee])')
    advanceThroughShowing(s)
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })
    step(s, { kind: 'submit' })
    let ctx = {
      sgfId: 1,
      config: { maxSubmits: 2, maxQuestions: 2 },
      loadTimeMs: performance.now() - 1000,  // pretend 1s elapsed
      rotated: false,
      viewport: { w: 1024, h: 768 },
    }
    let data = computeFinalizeData(s, ctx)

    expect(data.correct).toBe(1)
    expect(data.total).toBe(1)
    expect(data.stars).toBeGreaterThan(0)
    expect(data.scoreEntry.mistakes).toBe(0)
    expect(data.scoreEntry.mistakesByGroup).toEqual([0])
    expect(data.replayPayload.events).toBe(s.events)
    expect(data.replayPayload.config).toEqual(ctx.config)
    expect(data.replayPayload.viewport).toEqual({ w: 1024, h: 768, rotated: false })
    expect(data.replayPayload.goldens.scoreEntry).toBe(data.scoreEntry)
    expect(data.popupData.accPoints).toBe(data.scoreEntry.accPoints)
  })
})
