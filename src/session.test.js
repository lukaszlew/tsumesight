import { describe, it, expect } from 'vitest'
import { QuizSession, pointsByGroup } from './session.js'
import { QuizEngine } from './engine.js'

// Reference puzzles — simple, capture, pre-existing groups that change.
const refSgfs = {
  simple: '(;SZ[9];B[ee];W[ce];B[gc])',
  capture: '(;SZ[9];B[aa];W[ba];B[ee];W[ab])',
  setup: '(;SZ[9]AB[dd][ed]AW[de][ee];B[cd];W[ce])',
}

// Inline SGFs pulled from engine.test.js (deduped); broadens coverage.
const bulkSgfs = [
  '(;SZ[9];B[ee])',
  '(;SZ[9];B[aa])',
  '(;SZ[9];B[ea])',
  '(;SZ[9];B[ba];W[aa])',
  '(;SZ[9];B[ee];W[de])',
  '(;SZ[9];B[ee];W[aa])',
  '(;SZ[9];B[aa];W[ii])',
  '(;SZ[9];B[ee];W[de];B[ed])',
  '(;SZ[9];B[ee];W[aa];B[fe])',
  '(;SZ[9];B[ee];W[aa];B[fe];W[ba];B[ge])',
  '(;SZ[9];B[dd];W[aa];B[de];W[bb];B[ed])',
  '(;SZ[9]AB[dd];B[ee];W[aa])',
  '(;SZ[9]AB[ee];W[de])',
  '(;SZ[9]AB[ee];W[de];B[df])',
  '(;SZ[9]AB[ee];B[ef];W[aa])',
  '(;SZ[9]AB[aa];B[ee];W[ff])',
  '(;SZ[9]AB[ee][de][fe];W[aa];B[bb])',
  '(;SZ[9]AB[ee][de][fe][eh];B[eg];W[aa];B[ef])',
  '(;SZ[9]AB[ee][de][fe];W[ed];B[aa];W[dd];B[bb];W[ef])',
]

const allSgfs = [...Object.values(refSgfs), ...bulkSgfs]

function dispatchAllAdvances(session) {
  while (session.cursor < session.totalMoves) {
    session.applyEvent({ kind: 'advance' })
  }
}

describe('QuizSession — reference puzzles', () => {
  it('simple: plays through, phase transitions correctly', () => {
    let s = new QuizSession(refSgfs.simple)
    expect(s.cursor).toBe(0)
    expect(s.phase).toBe('showing')
    s.applyEvent({ kind: 'advance' })
    expect(s.cursor).toBe(1)
    expect(s.phase).toBe('showing')
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    expect(s.cursor).toBe(3)
    expect(['exercise-fresh', 'finished']).toContain(s.phase)
  })

  it('simple: throws on advance past end', () => {
    let s = new QuizSession(refSgfs.simple)
    dispatchAllAdvances(s)
    expect(() => s.applyEvent({ kind: 'advance' })).toThrow(/advance at cursor=3/)
  })

  it('capture: final board reflects captured stone', () => {
    let s = new QuizSession(refSgfs.capture)
    dispatchAllAdvances(s)
    // B[aa] captured by W[ba]+W[ab]
    expect(s.engine.trueBoard.get([0, 0])).toBe(0)
    expect(s.engine.trueBoard.get([1, 0])).toBe(-1)
    expect(s.engine.trueBoard.get([0, 1])).toBe(-1)
  })

  it('setup: groups with changed liberties are detected', () => {
    let s = new QuizSession(refSgfs.setup)
    dispatchAllAdvances(s)
    if (s.hasExercise) {
      expect(s.changedGroups.length).toBeGreaterThan(0)
    }
  })
})

describe('QuizSession — differential vs QuizEngine', () => {
  // Session reuses QuizEngine for Go logic; this confirms the reuse is
  // lossless: same groups detected, same liberty counts, same "changed"
  // flags as driving the old engine directly.
  for (let sgf of allSgfs) {
    it(`${sgf}: matches old engine on final groups`, () => {
      let old = new QuizEngine(sgf, true, 2)
      while (!old.finished) old.advance()
      // Old engine enters FINISHED without calling activateQuestions
      // if past last move. Re-create and drive just to last move.
      old = new QuizEngine(sgf, true, 2)
      while (old.moveIndex < old.totalMoves) old.advance()
      old.activateQuestions()
      let oldGroups = (old.libertyExercise?.groups || []).map(g => ({
        v: g.vertex, lib: g.libCount, changed: g.changed,
      }))

      let s = new QuizSession(sgf, { maxQuestions: 2 })
      dispatchAllAdvances(s)
      let newGroups = (s.engine.libertyExercise?.groups || []).map(g => ({
        v: g.vertex, lib: g.libCount, changed: g.changed,
      }))

      expect(newGroups).toEqual(oldGroups)
    })
  }
})

describe('QuizSession — rewind preserves state', () => {
  it('rewind preserves marks, submitCount, feedback, startTime', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 2 })  // wrong
    s.applyEvent({ kind: 'submit' })
    let startTimeBefore = s.startTime
    let marksSize = s.marks.size
    let submitCountBefore = s.submitCount
    let feedbackBefore = s.feedback

    s.applyEvent({ kind: 'rewind' })

    expect(s.cursor).toBe(0)
    expect(s.marks.size).toBe(marksSize)
    expect(s.submitCount).toBe(submitCountBefore)
    expect(s.feedback).toEqual(feedbackBefore)
    expect(s.startTime).toBe(startTimeBefore)
    expect(s.phase).toBe('showing')
  })

  it('rewind then advance reaches the same exercise state', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    expect(s.hasExercise).toBe(true)
    s.applyEvent({ kind: 'rewind' })
    expect(s.hasExercise).toBe(false)
    s.applyEvent({ kind: 'advance' })
    expect(s.hasExercise).toBe(true)
  })
})

describe('QuizSession — finalization rules', () => {
  it('finalizes immediately if all correct', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    // Center stone on empty board: 4 liberties
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })
    s.applyEvent({ kind: 'submit' })
    expect(s.phase).toBe('finished')
    expect(s.finalized).toBe(true)
  })

  it('exercise-feedback after first wrong submit; finalized after 2nd', () => {
    let s = new QuizSession('(;SZ[9];B[ee])', { maxSubmits: 2 })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 2 })  // wrong
    s.applyEvent({ kind: 'submit' })
    expect(s.phase).toBe('exercise-feedback')
    expect(s.finalized).toBe(false)
    s.applyEvent({ kind: 'submit' })
    expect(s.phase).toBe('finished')
    expect(s.finalized).toBe(true)
  })

  it('configurable maxSubmits = 3', () => {
    let s = new QuizSession('(;SZ[9];B[ee])', { maxSubmits: 3 })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 2 })
    s.applyEvent({ kind: 'submit' })
    s.applyEvent({ kind: 'submit' })
    expect(s.phase).toBe('exercise-feedback')
    s.applyEvent({ kind: 'submit' })
    expect(s.phase).toBe('finished')
  })

  it('setMark throws after finalized', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })
    s.applyEvent({ kind: 'submit' })  // finalized
    expect(() => s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 2 })).toThrow(/finalized/)
  })
})

describe('QuizSession — mistake counting (fold over submits)', () => {
  it('counts per-submit wrongs, capped at 2 per group', () => {
    let s = new QuizSession('(;SZ[9];B[ee])', { maxSubmits: 2 })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 2 })  // wrong
    s.applyEvent({ kind: 'submit' })
    s.applyEvent({ kind: 'submit' })  // still wrong, force-commit
    let mbg = s.mistakesByGroup()
    expect(mbg).toEqual([2])
    expect(pointsByGroup(mbg)).toEqual([0])
  })

  it('1 wrong then correct → 1 mistake → 5 pts', () => {
    let s = new QuizSession('(;SZ[9];B[ee])', { maxSubmits: 2 })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 2 })  // wrong
    s.applyEvent({ kind: 'submit' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })  // correct
    s.applyEvent({ kind: 'submit' })
    let mbg = s.mistakesByGroup()
    expect(mbg).toEqual([1])
    expect(pointsByGroup(mbg)).toEqual([5])
  })

  it('all correct first try → 0 mistakes → 10 pts', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })
    s.applyEvent({ kind: 'submit' })
    let mbg = s.mistakesByGroup()
    expect(mbg).toEqual([0])
    expect(pointsByGroup(mbg)).toEqual([10])
  })
})

describe('QuizSession — event log', () => {
  it('records every event with timestamps', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })
    s.applyEvent({ kind: 'submit' })
    expect(s.events.length).toBe(3)
    expect(s.events.map(e => e.kind)).toEqual(['advance', 'setMark', 'submit'])
    for (let e of s.events) {
      expect(typeof e.t).toBe('number')
      expect(e.t).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('QuizSession — tapping rules (no group awareness)', () => {
  it('mark on any intersection is stored; only scoring checks groups', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    // Mark an empty intersection — allowed, stored, but ignored by scoring.
    s.applyEvent({ kind: 'setMark', vertex: [0, 0], value: 3 })
    expect(s.marks.get('0,0')).toBe(3)
    // Mark the actual stone correctly and submit.
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })
    s.applyEvent({ kind: 'submit' })
    expect(s.mistakesByGroup()).toEqual([0])
  })
})
