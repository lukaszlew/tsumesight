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

// Drive every 'showing' state until we exit into exercise or finished.
// For an N-move puzzle with an exercise, this is N+1 advances (one per
// shown move plus one to activate questions).
function dispatchAllAdvances(session) {
  while (session.phase === 'showing') {
    session.applyEvent({ kind: 'advance' })
  }
}

describe('QuizSession — reference puzzles', () => {
  it('simple: each advance produces one visible state change', () => {
    let s = new QuizSession(refSgfs.simple)
    expect(s.cursor).toBe(0)
    expect(s.phase).toBe('showing')
    expect(s.engine.showingMove).toBe(false)

    s.applyEvent({ kind: 'advance' })
    expect(s.cursor).toBe(1)
    expect(s.phase).toBe('showing')
    expect(s.engine.showingMove).toBe(true)

    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    expect(s.cursor).toBe(3)
    // After N advances, last move is showing. Exercise has NOT been entered yet.
    expect(s.phase).toBe('showing')
    expect(s.engine.showingMove).toBe(true)
    expect(s.hasExercise).toBe(false)

    // One more advance activates the exercise (or finishes if no changed groups).
    s.applyEvent({ kind: 'advance' })
    expect(s.cursor).toBe(4)
    expect(['exercise', 'finished']).toContain(s.phase)
  })

  it('simple: throws on advance past end', () => {
    let s = new QuizSession(refSgfs.simple)
    dispatchAllAdvances(s)
    expect(() => s.applyEvent({ kind: 'advance' })).toThrow(/advance at cursor/)
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

describe('QuizSession — last move visibility (regression)', () => {
  // Bug: session used to call engine.activateQuestions() in the same
  // dispatch as the last engine.advance(), collapsing two visible states
  // into one. The last move's stone was never shown on its own.
  it('single-move puzzle shows the move before activating the exercise', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    expect(s.phase).toBe('showing')
    expect(s.engine.showingMove).toBe(true)
    expect(s.engine.currentMove).toBeTruthy()
    expect(s.engine.currentMove.vertex).toEqual([4, 4])
    expect(s.hasExercise).toBe(false)

    s.applyEvent({ kind: 'advance' })
    expect(s.phase).toBe('exercise')
    expect(s.hasExercise).toBe(true)
    expect(s.engine.showingMove).toBe(false)
  })

  it('each non-last advance keeps showingMove=true for current move', () => {
    let s = new QuizSession('(;SZ[9];B[ee];W[aa];B[fe];W[ba];B[ge])')
    for (let i = 1; i <= s.totalMoves; i++) {
      s.applyEvent({ kind: 'advance' })
      expect(s.cursor).toBe(i)
      expect(s.phase).toBe('showing')
      expect(s.engine.showingMove).toBe(true)
      expect(s.engine.currentMove).toBeTruthy()
    }
    // Exactly one more advance transitions past showing.
    s.applyEvent({ kind: 'advance' })
    expect(s.phase).not.toBe('showing')
  })
})

describe('QuizSession — differential vs QuizEngine', () => {
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
  it('rewind preserves marks, submitCount, submitResults, startTime', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })   // show last move
    s.applyEvent({ kind: 'advance' })   // activate exercise
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 2 })  // wrong
    s.applyEvent({ kind: 'submit' })
    let startTimeBefore = s.startTime
    let marksSnapshot = new Map(s.marks)
    let submitCountBefore = s.submitCount
    let submitResultsBefore = [...s.submitResults]

    s.applyEvent({ kind: 'rewind' })

    expect(s.cursor).toBe(0)
    expect(s.marks).toEqual(marksSnapshot)
    expect(s.submitCount).toBe(submitCountBefore)
    expect(s.submitResults).toEqual(submitResultsBefore)
    expect(s.startTime).toBe(startTimeBefore)
    expect(s.phase).toBe('showing')
  })

  it('rewind then advance re-enters the same exercise state', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    expect(s.hasExercise).toBe(true)
    s.applyEvent({ kind: 'rewind' })
    expect(s.hasExercise).toBe(false)
    expect(s.cursor).toBe(0)
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    expect(s.hasExercise).toBe(true)
  })
})

describe('QuizSession — finalization rules', () => {
  it('finalizes immediately if all correct', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    // Center stone on empty board: 4 liberties
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })
    s.applyEvent({ kind: 'submit' })
    expect(s.phase).toBe('finished')
    expect(s.finalized).toBe(true)
  })

  it('stays in exercise after first wrong submit; finalized after 2nd', () => {
    let s = new QuizSession('(;SZ[9];B[ee])', { maxSubmits: 2 })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 2 })  // wrong
    s.applyEvent({ kind: 'submit' })
    expect(s.phase).toBe('exercise')
    expect(s.finalized).toBe(false)
    s.applyEvent({ kind: 'submit' })
    expect(s.phase).toBe('finished')
    expect(s.finalized).toBe(true)
  })

  it('configurable maxSubmits = 3', () => {
    let s = new QuizSession('(;SZ[9];B[ee])', { maxSubmits: 3 })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 2 })
    s.applyEvent({ kind: 'submit' })
    s.applyEvent({ kind: 'submit' })
    expect(s.phase).toBe('exercise')
    s.applyEvent({ kind: 'submit' })
    expect(s.phase).toBe('finished')
  })

  it('setMark throws after finalized', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
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
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })
    s.applyEvent({ kind: 'submit' })
    let mbg = s.mistakesByGroup()
    expect(mbg).toEqual([0])
    expect(pointsByGroup(mbg)).toEqual([10])
  })
})

describe('QuizSession — fold event log reconstructs state', () => {
  // Restore-on-reopen replays the stored event log through a fresh session.
  // The result must match the original: same marks (value + color), same
  // submitResults, same mistake counts, same phase.
  function expectSameState(a, b) {
    expect(b.cursor).toBe(a.cursor)
    expect(b.phase).toBe(a.phase)
    expect(b.submitCount).toBe(a.submitCount)
    expect(b.finalized).toBe(a.finalized)
    expect(b.submitResults).toEqual(a.submitResults)
    expect(b.mistakesByGroup()).toEqual(a.mistakesByGroup())
    expect([...b.marks.entries()]).toEqual([...a.marks.entries()])
  }

  it('wrong-then-correct session', () => {
    let s1 = new QuizSession('(;SZ[9];B[ba];W[aa])', { maxSubmits: 2 })
    while (s1.phase === 'showing') s1.applyEvent({ kind: 'advance' })
    s1.applyEvent({ kind: 'setMark', vertex: [0, 0], value: 1 })  // W[aa]: wrong
    s1.applyEvent({ kind: 'submit' })
    s1.applyEvent({ kind: 'setMark', vertex: [0, 0], value: 2 })  // correct
    s1.applyEvent({ kind: 'setMark', vertex: [1, 0], value: 3 })  // B[ba] correct
    s1.applyEvent({ kind: 'submit' })

    let s2 = new QuizSession('(;SZ[9];B[ba];W[aa])', { maxSubmits: 2 })
    for (let evt of s1.events) s2.applyEvent(evt)
    expectSameState(s1, s2)
  })

  it('force-commit session (two wrong submits)', () => {
    let s1 = new QuizSession('(;SZ[9];B[ee])', { maxSubmits: 2 })
    while (s1.phase === 'showing') s1.applyEvent({ kind: 'advance' })
    s1.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 2 })
    s1.applyEvent({ kind: 'submit' })
    s1.applyEvent({ kind: 'submit' })   // force-commit

    let s2 = new QuizSession('(;SZ[9];B[ee])', { maxSubmits: 2 })
    for (let evt of s1.events) s2.applyEvent(evt)
    expectSameState(s1, s2)
    expect(s2.mistakesByGroup()).toEqual([2])
  })

  it('rewind then completion', () => {
    let s1 = new QuizSession('(;SZ[9];B[ee];W[aa])')
    s1.applyEvent({ kind: 'advance' })
    s1.applyEvent({ kind: 'rewind' })
    while (s1.phase === 'showing') s1.applyEvent({ kind: 'advance' })
    // first group: correct if 3 libs (B[ee] becomes 4-1 liberties, W[aa] is 2)
    let groups = s1.changedGroups
    for (let g of groups) {
      let vkey = [...g.chainKeys][0]
      let [x, y] = vkey.split(',').map(Number)
      s1.applyEvent({ kind: 'setMark', vertex: [x, y], value: Math.min(g.libCount, 5) })
    }
    s1.applyEvent({ kind: 'submit' })

    let s2 = new QuizSession('(;SZ[9];B[ee];W[aa])')
    for (let evt of s1.events) s2.applyEvent(evt)
    expectSameState(s1, s2)
  })
})

describe('QuizSession — event log', () => {
  it('records every event with timestamps', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })
    s.applyEvent({ kind: 'submit' })
    expect(s.events.length).toBe(4)
    expect(s.events.map(e => e.kind)).toEqual(['advance', 'advance', 'setMark', 'submit'])
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
    s.applyEvent({ kind: 'advance' })
    // Mark an empty intersection — allowed, stored, but ignored by scoring.
    s.applyEvent({ kind: 'setMark', vertex: [0, 0], value: 3 })
    expect(s.marks.get('0,0')).toEqual({ value: 3, color: null })
    // Mark the actual stone correctly and submit.
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })
    s.applyEvent({ kind: 'submit' })
    expect(s.mistakesByGroup()).toEqual([0])
  })
})

describe('QuizSession — locked (pre-marked) intersections', () => {
  // An unchanged group shows its fixed liberty count at one representative
  // intersection. That single intersection is not editable; other stones of
  // the same group stay tappable.
  it('setMark is a no-op on a pre-marked group representative', () => {
    // AB[aa] is a lone corner stone, untouched by the moves. It stays with
    // 2 liberties throughout → pre-marked (not a "changed" group).
    let s = new QuizSession('(;SZ[9]AB[aa];B[ee];W[ff])')
    while (s.phase === 'showing') s.applyEvent({ kind: 'advance' })

    // Find the pre-marked group and confirm its representative is locked.
    let preMarked = s.engine.libertyExercise.groups.find(g => !g.changed)
    expect(preMarked).toBeTruthy()
    let lockedVertex = preMarked.vertex
    expect(s.isLockedVertex(lockedVertex)).toBe(true)

    let marksBefore = new Map(s.marks)
    let eventsBefore = s.events.length
    s.applyEvent({ kind: 'setMark', vertex: lockedVertex, value: 3 })
    // marks unchanged; event not recorded.
    expect(s.marks).toEqual(marksBefore)
    expect(s.events.length).toBe(eventsBefore)
  })

  it('setMark is allowed on a changed-group stone', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    expect(s.isLockedVertex([4, 4])).toBe(false)
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })
    expect(s.marks.get('4,4')).toEqual({ value: 4, color: null })
  })
})

describe('QuizSession — eval overwrites marks with colors', () => {
  it('correct mark gains green color after submit', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })  // correct
    s.applyEvent({ kind: 'submit' })
    expect(s.marks.get('4,4')).toEqual({ value: 4, color: 'green' })
  })

  it('wrong mark gains red color after submit', () => {
    let s = new QuizSession('(;SZ[9];B[ee])', { maxSubmits: 2 })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 2 })  // wrong
    s.applyEvent({ kind: 'submit' })
    expect(s.marks.get('4,4')).toEqual({ value: 2, color: 'red' })
  })

  it('missed group shows ? at group vertex in red', () => {
    let s = new QuizSession('(;SZ[9];B[ee])', { maxSubmits: 2 })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'submit' })   // no marks → missed
    let g = s.changedGroups[0]
    let key = `${g.vertex[0]},${g.vertex[1]}`
    expect(s.marks.get(key)).toEqual({ value: '?', color: 'red' })
  })

  it('user tap after submit overwrites color at that intersection', () => {
    let s = new QuizSession('(;SZ[9];B[ee])', { maxSubmits: 2 })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 2 })
    s.applyEvent({ kind: 'submit' })
    expect(s.marks.get('4,4').color).toBe('red')
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })
    expect(s.marks.get('4,4')).toEqual({ value: 4, color: null })
  })

  it('marks on non-group intersections are preserved through submit', () => {
    let s = new QuizSession('(;SZ[9];B[ee])')
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [0, 0], value: 3 })  // empty intersection
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })  // actual stone
    s.applyEvent({ kind: 'submit' })
    // Non-group mark persists as-is; group mark gains color.
    expect(s.marks.get('0,0')).toEqual({ value: 3, color: null })
    expect(s.marks.get('4,4')).toEqual({ value: 4, color: 'green' })
  })

  it('second submit re-evaluates and overwrites colors', () => {
    let s = new QuizSession('(;SZ[9];B[ee])', { maxSubmits: 2 })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'advance' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 2 })
    s.applyEvent({ kind: 'submit' })
    s.applyEvent({ kind: 'setMark', vertex: [4, 4], value: 4 })
    s.applyEvent({ kind: 'submit' })
    expect(s.marks.get('4,4')).toEqual({ value: 4, color: 'green' })
  })
})
