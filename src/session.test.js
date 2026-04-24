import { describe, it, expect } from 'vitest'
import {
  init, step, phase, finalized, changedGroups, isLockedVertex,
  mistakesByGroup, totalMistakes, pointsByGroup, penaltyByGroup,
} from './session.js'
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

// Drive every 'showing' state until we exit into exercise or finished.
// For an N-move puzzle with an exercise, this is N+1 advances (one per
// shown move plus one to activate questions).
function dispatchAllAdvances(session) {
  while (phase(session) === 'showing') {
    step(session, { kind: 'advance' })
  }
}

describe('session — reference puzzles', () => {
  it('simple: each advance produces one visible state change', () => {
    let s = init(refSgfs.simple)
    expect(s.cursor).toBe(0)
    expect(phase(s)).toBe('showing')
    expect(s.engine.showingMove).toBe(false)

    step(s, { kind: 'advance' })
    expect(s.cursor).toBe(1)
    expect(phase(s)).toBe('showing')
    expect(s.engine.showingMove).toBe(true)

    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    expect(s.cursor).toBe(3)
    // After N advances, last move is showing. Exercise has NOT been entered yet.
    expect(phase(s)).toBe('showing')
    expect(s.engine.showingMove).toBe(true)
    expect(s.hasExercise).toBe(false)

    // One more advance activates the exercise (or finishes if no changed groups).
    step(s, { kind: 'advance' })
    expect(s.cursor).toBe(4)
    expect(['exercise', 'finished']).toContain(phase(s))
  })

  it('simple: throws on advance past end', () => {
    let s = init(refSgfs.simple)
    dispatchAllAdvances(s)
    expect(() => step(s, { kind: 'advance' })).toThrow(/advance at cursor/)
  })

  it('capture: final board reflects captured stone', () => {
    let s = init(refSgfs.capture)
    dispatchAllAdvances(s)
    // B[aa] captured by W[ba]+W[ab]
    expect(s.engine.trueBoard.get([0, 0])).toBe(0)
    expect(s.engine.trueBoard.get([1, 0])).toBe(-1)
    expect(s.engine.trueBoard.get([0, 1])).toBe(-1)
  })

  it('setup: groups with changed liberties are detected', () => {
    let s = init(refSgfs.setup)
    dispatchAllAdvances(s)
    if (s.hasExercise) {
      expect(changedGroups(s).length).toBeGreaterThan(0)
    }
  })
})

describe('session — last move visibility (regression)', () => {
  // Bug: session used to call engine.activateQuestions() in the same
  // dispatch as the last engine.advance(), collapsing two visible states
  // into one. The last move's stone was never shown on its own.
  it('single-move puzzle shows the move before activating the exercise', () => {
    let s = init('(;SZ[9];B[ee])')
    step(s, { kind: 'advance' })
    expect(phase(s)).toBe('showing')
    expect(s.engine.showingMove).toBe(true)
    expect(s.engine.currentMove).toBeTruthy()
    expect(s.engine.currentMove.vertex).toEqual([4, 4])
    expect(s.hasExercise).toBe(false)

    step(s, { kind: 'advance' })
    expect(phase(s)).toBe('exercise')
    expect(s.hasExercise).toBe(true)
    expect(s.engine.showingMove).toBe(false)
  })

  it('each non-last advance keeps showingMove=true for current move', () => {
    let s = init('(;SZ[9];B[ee];W[aa];B[fe];W[ba];B[ge])')
    for (let i = 1; i <= s.totalMoves; i++) {
      step(s, { kind: 'advance' })
      expect(s.cursor).toBe(i)
      expect(phase(s)).toBe('showing')
      expect(s.engine.showingMove).toBe(true)
      expect(s.engine.currentMove).toBeTruthy()
    }
    // Exactly one more advance transitions past showing.
    step(s, { kind: 'advance' })
    expect(phase(s)).not.toBe('showing')
  })
})

describe('session — differential vs QuizEngine', () => {
  // Session reuses QuizEngine for Go logic; this confirms the reuse is
  // lossless: same groups detected, same liberty counts, same "changed"
  // flags as driving the old engine directly.
  for (let sgf of allSgfs) {
    it(`${sgf}: matches old engine on final groups`, () => {
      let old = new QuizEngine(sgf, true, 2)
      while (old.moveIndex < old.totalMoves) old.advance()
      old.activateQuestions()
      let oldGroups = (old.libertyExercise?.groups || []).map(g => ({
        v: g.vertex, lib: g.libCount, changed: g.changed,
      }))

      let s = init(sgf, { maxQuestions: 2 })
      dispatchAllAdvances(s)
      let newGroups = (s.engine.libertyExercise?.groups || []).map(g => ({
        v: g.vertex, lib: g.libCount, changed: g.changed,
      }))

      expect(newGroups).toEqual(oldGroups)
    })
  }
})

describe('session — rewind preserves state', () => {
  it('rewind preserves marks, submitCount, submitResults, startTime', () => {
    let s = init('(;SZ[9];B[ee])')
    step(s, { kind: 'advance' })   // show last move
    step(s, { kind: 'advance' })   // activate exercise
    step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })  // wrong
    step(s, { kind: 'submit' })
    let startTimeBefore = s.startTime
    let marksSnapshot = new Map(s.marks)
    let submitCountBefore = s.submitCount
    let submitResultsBefore = [...s.submitResults]

    step(s, { kind: 'rewind' })

    expect(s.cursor).toBe(0)
    expect(s.marks).toEqual(marksSnapshot)
    expect(s.submitCount).toBe(submitCountBefore)
    expect(s.submitResults).toEqual(submitResultsBefore)
    expect(s.startTime).toBe(startTimeBefore)
    expect(phase(s)).toBe('showing')
  })

  it('rewind then advance re-enters the same exercise state', () => {
    let s = init('(;SZ[9];B[ee])')
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    expect(s.hasExercise).toBe(true)
    step(s, { kind: 'rewind' })
    expect(s.hasExercise).toBe(false)
    expect(s.cursor).toBe(0)
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    expect(s.hasExercise).toBe(true)
  })
})

describe('session — finalization rules', () => {
  it('finalizes immediately if all correct', () => {
    let s = init('(;SZ[9];B[ee])')
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    // Center stone on empty board: 4 liberties
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })
    step(s, { kind: 'submit' })
    expect(phase(s)).toBe('finished')
    expect(finalized(s)).toBe(true)
  })

  it('stays in exercise after first wrong submit; finalized after 2nd', () => {
    let s = init('(;SZ[9];B[ee])', { maxSubmits: 2 })
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })  // wrong
    step(s, { kind: 'submit' })
    expect(phase(s)).toBe('exercise')
    expect(finalized(s)).toBe(false)
    step(s, { kind: 'submit' })
    expect(phase(s)).toBe('finished')
    expect(finalized(s)).toBe(true)
  })

  it('configurable maxSubmits = 3', () => {
    let s = init('(;SZ[9];B[ee])', { maxSubmits: 3 })
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })
    step(s, { kind: 'submit' })
    step(s, { kind: 'submit' })
    expect(phase(s)).toBe('exercise')
    step(s, { kind: 'submit' })
    expect(phase(s)).toBe('finished')
  })

  it('setMark throws after finalized', () => {
    let s = init('(;SZ[9];B[ee])')
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })
    step(s, { kind: 'submit' })  // finalized
    expect(() => step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })).toThrow(/finalized/)
  })
})

describe('session — mistake counting (fold over submits)', () => {
  it('counts per-submit wrongs under 2-try cap → 2 mistakes → 6 pts', () => {
    let s = init('(;SZ[9];B[ee])', { maxSubmits: 2 })
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })  // wrong
    step(s, { kind: 'submit' })
    step(s, { kind: 'submit' })  // still wrong, force-commit
    let mbg = mistakesByGroup(s)
    expect(mbg).toEqual([2])
    expect(pointsByGroup(mbg)).toEqual([6])    // schedule[2] = 6
  })

  it('3 wrong submits under 3-try cap → 3 mistakes → 0 pts', () => {
    let s = init('(;SZ[9];B[ee])', { maxSubmits: 3 })
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })
    step(s, { kind: 'submit' })
    step(s, { kind: 'submit' })
    step(s, { kind: 'submit' })   // force-commit at 3
    let mbg = mistakesByGroup(s)
    expect(mbg).toEqual([3])
    expect(pointsByGroup(mbg)).toEqual([0])    // schedule[3] = 0
  })

  it('1 wrong then correct → 1 mistake → 12 pts', () => {
    let s = init('(;SZ[9];B[ee])', { maxSubmits: 2 })
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })  // wrong
    step(s, { kind: 'submit' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })  // correct
    step(s, { kind: 'submit' })
    let mbg = mistakesByGroup(s)
    expect(mbg).toEqual([1])
    expect(pointsByGroup(mbg)).toEqual([12])   // schedule[1] = 12
  })

  it('all correct first try → 0 mistakes → 20 pts', () => {
    let s = init('(;SZ[9];B[ee])')
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })
    step(s, { kind: 'submit' })
    let mbg = mistakesByGroup(s)
    expect(mbg).toEqual([0])
    expect(pointsByGroup(mbg)).toEqual([20])
  })
})

describe('session — fold event log reconstructs state', () => {
  // Restore-on-reopen replays the stored event log through a fresh session.
  // The result must match the original: same marks (value + color), same
  // submitResults, same mistake counts, same phase.
  function expectSameState(a, b) {
    expect(b.cursor).toBe(a.cursor)
    expect(phase(b)).toBe(phase(a))
    expect(b.submitCount).toBe(a.submitCount)
    expect(finalized(b)).toBe(finalized(a))
    expect(b.submitResults).toEqual(a.submitResults)
    expect(mistakesByGroup(b)).toEqual(mistakesByGroup(a))
    expect([...b.marks.entries()]).toEqual([...a.marks.entries()])
  }

  it('wrong-then-correct session', () => {
    let s1 = init('(;SZ[9];B[ba];W[aa])', { maxSubmits: 2 })
    while (phase(s1) === 'showing') step(s1, { kind: 'advance' })
    step(s1, { kind: 'setMark', vertex: [0, 0], value: 1 })  // W[aa]: wrong
    step(s1, { kind: 'submit' })
    step(s1, { kind: 'setMark', vertex: [0, 0], value: 2 })  // correct
    step(s1, { kind: 'setMark', vertex: [1, 0], value: 3 })  // B[ba] correct
    step(s1, { kind: 'submit' })

    let s2 = init('(;SZ[9];B[ba];W[aa])', { maxSubmits: 2 })
    for (let evt of s1.events) step(s2, evt)
    expectSameState(s1, s2)
  })

  it('force-commit session (two wrong submits)', () => {
    let s1 = init('(;SZ[9];B[ee])', { maxSubmits: 2 })
    while (phase(s1) === 'showing') step(s1, { kind: 'advance' })
    step(s1, { kind: 'setMark', vertex: [4, 4], value: 2 })
    step(s1, { kind: 'submit' })
    step(s1, { kind: 'submit' })   // force-commit

    let s2 = init('(;SZ[9];B[ee])', { maxSubmits: 2 })
    for (let evt of s1.events) step(s2, evt)
    expectSameState(s1, s2)
    expect(mistakesByGroup(s2)).toEqual([2])
  })

  it('rewind then completion', () => {
    let s1 = init('(;SZ[9];B[ee];W[aa])')
    step(s1, { kind: 'advance' })
    step(s1, { kind: 'rewind' })
    while (phase(s1) === 'showing') step(s1, { kind: 'advance' })
    // first group: correct if 3 libs (B[ee] becomes 4-1 liberties, W[aa] is 2)
    let groups = changedGroups(s1)
    for (let g of groups) {
      let vkey = [...g.chainKeys][0]
      let [x, y] = vkey.split(',').map(Number)
      step(s1, { kind: 'setMark', vertex: [x, y], value: Math.min(g.libCount, 5) })
    }
    step(s1, { kind: 'submit' })

    let s2 = init('(;SZ[9];B[ee];W[aa])')
    for (let evt of s1.events) step(s2, evt)
    expectSameState(s1, s2)
  })
})

describe('session — event log', () => {
  it('records every event with timestamps', () => {
    let s = init('(;SZ[9];B[ee])')
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })
    step(s, { kind: 'submit' })
    expect(s.events.length).toBe(4)
    expect(s.events.map(e => e.kind)).toEqual(['advance', 'advance', 'setMark', 'submit'])
    for (let e of s.events) {
      expect(typeof e.t).toBe('number')
      expect(e.t).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('session — tapping rules (no group awareness)', () => {
  it('mark on any intersection is stored; only scoring checks groups', () => {
    let s = init('(;SZ[9];B[ee])')
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    // Mark an empty intersection — allowed, stored, but ignored by scoring.
    step(s, { kind: 'setMark', vertex: [0, 0], value: 3 })
    expect(s.marks.get('0,0')).toEqual({ value: 3, color: null })
    // Mark the actual stone correctly and submit.
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })
    step(s, { kind: 'submit' })
    expect(mistakesByGroup(s)).toEqual([0])
  })
})

describe('session — locked (pre-marked) intersections', () => {
  // An unchanged group shows its fixed liberty count at one representative
  // intersection. That single intersection is not editable; other stones of
  // the same group stay tappable.
  it('setMark is a no-op on a pre-marked group representative', () => {
    // AB[aa] is a lone corner stone, untouched by the moves. It stays with
    // 2 liberties throughout → pre-marked (not a "changed" group).
    let s = init('(;SZ[9]AB[aa];B[ee];W[ff])')
    while (phase(s) === 'showing') step(s, { kind: 'advance' })

    // Find the pre-marked group and confirm its representative is locked.
    let preMarked = s.engine.libertyExercise.groups.find(g => !g.changed)
    expect(preMarked).toBeTruthy()
    let lockedVertex = preMarked.vertex
    expect(isLockedVertex(s, lockedVertex)).toBe(true)

    let marksBefore = new Map(s.marks)
    let eventsBefore = s.events.length
    step(s, { kind: 'setMark', vertex: lockedVertex, value: 3 })
    // marks unchanged; event not recorded.
    expect(s.marks).toEqual(marksBefore)
    expect(s.events.length).toBe(eventsBefore)
  })

  it('setMark is allowed on a changed-group stone', () => {
    let s = init('(;SZ[9];B[ee])')
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    expect(isLockedVertex(s, [4, 4])).toBe(false)
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })
    expect(s.marks.get('4,4')).toEqual({ value: 4, color: null })
  })
})

describe('session — eval overwrites marks with colors', () => {
  it('correct mark gains green color after submit', () => {
    let s = init('(;SZ[9];B[ee])')
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })  // correct
    step(s, { kind: 'submit' })
    expect(s.marks.get('4,4')).toEqual({ value: 4, color: 'green' })
  })

  it('wrong mark gains red color after submit', () => {
    let s = init('(;SZ[9];B[ee])', { maxSubmits: 2 })
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })  // wrong
    step(s, { kind: 'submit' })
    expect(s.marks.get('4,4')).toEqual({ value: 2, color: 'red' })
  })

  it('missed group shows ? at group vertex in red', () => {
    let s = init('(;SZ[9];B[ee])', { maxSubmits: 2 })
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'submit' })   // no marks → missed
    let g = changedGroups(s)[0]
    let key = `${g.vertex[0]},${g.vertex[1]}`
    expect(s.marks.get(key)).toEqual({ value: '?', color: 'red' })
  })

  it('user tap after submit overwrites color at that intersection', () => {
    let s = init('(;SZ[9];B[ee])', { maxSubmits: 2 })
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })
    step(s, { kind: 'submit' })
    expect(s.marks.get('4,4').color).toBe('red')
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })
    expect(s.marks.get('4,4')).toEqual({ value: 4, color: null })
  })

  it('marks on non-group intersections are preserved through submit', () => {
    let s = init('(;SZ[9];B[ee])')
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'setMark', vertex: [0, 0], value: 3 })  // empty intersection
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })  // actual stone
    step(s, { kind: 'submit' })
    // Non-group mark persists as-is; group mark gains color.
    expect(s.marks.get('0,0')).toEqual({ value: 3, color: null })
    expect(s.marks.get('4,4')).toEqual({ value: 4, color: 'green' })
  })

  it('second submit re-evaluates and overwrites colors', () => {
    let s = init('(;SZ[9];B[ee])', { maxSubmits: 2 })
    step(s, { kind: 'advance' })
    step(s, { kind: 'advance' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })
    step(s, { kind: 'submit' })
    step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })
    step(s, { kind: 'submit' })
    expect(s.marks.get('4,4')).toEqual({ value: 4, color: 'green' })
  })
})
