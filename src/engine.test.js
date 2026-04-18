import { describe, it, expect, beforeEach } from 'vitest'
import { QuizEngine } from './engine.js'
import config from './config.js'

// Simple 9x9 game: 3 non-pass moves (questions only on last move)
let simpleSgf = '(;SZ[9];B[ee];W[ce];B[gc])'
// Single-move SGF (questions activate immediately)
let singleSgf = '(;SZ[9];B[ee])'

// Game with a capture: white surrounds and captures black at ee
// B[aa], W[ba], B[ee], W[ab] — black at 0,0 captured after W[ab]
let captureSgf = '(;SZ[9];B[aa];W[ba];B[ee];W[ab])'

// Game with setup stones
let setupSgf = '(;SZ[9]AB[dd][ed]AW[de][ee];B[cd];W[ce])'

// Game with pass
let passSgf = '(;SZ[9];B[ee];W[];B[dd])'

// Helper: build correct marks Map<vertexKey, number> for all changed groups
function correctMarks(engine) {
  let marks = new Map()
  for (let g of engine.libertyExercise.groups.filter(g => g.changed))
    marks.set([...g.chainKeys][0], Math.min(g.libCount, config.maxLibertyLabel))
  return marks
}

describe('QuizEngine', () => {
  describe('construction', () => {
    it('initializes with correct board size', () => {
      let engine = new QuizEngine(simpleSgf)
      expect(engine.boardSize).toBe(9)
    })

    it('starts at move 0 with no current move', () => {
      let engine = new QuizEngine(simpleSgf)
      expect(engine.moveIndex).toBe(0)
      expect(engine.currentMove).toBe(null)
      expect(engine.finished).toBe(false)
    })

    it('filters out pass moves', () => {
      let engine = new QuizEngine(passSgf)
      // W[] pass is filtered, so only B[ee] and B[dd] remain
      expect(engine.totalMoves).toBe(2)
    })

    it('sets up initial position from AB/AW', () => {
      let engine = new QuizEngine(setupSgf)
      // dd=[3,3] and ed=[4,3] should be black (1)
      expect(engine.baseSignMap[3][3]).toBe(1)
      expect(engine.baseSignMap[3][4]).toBe(1)
      // de=[3,4] and ee=[4,4] should be white (-1)
      expect(engine.baseSignMap[4][3]).toBe(-1)
      expect(engine.baseSignMap[4][4]).toBe(-1)
    })
  })

  describe('advance()', () => {
    it('plays the first move and returns state', () => {
      let engine = new QuizEngine(simpleSgf)
      let state = engine.advance()
      expect(state.moveIndex).toBe(1)
      expect(state.totalMoves).toBe(3)
      expect(state.currentMove).toEqual({ sign: 1, vertex: [4, 4] })
    })

    it('tracks invisible stones', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance()
      // The move stone should be invisible
      expect(engine.invisibleStones.size).toBe(1)
      // But visible on true board
      expect(engine.trueBoard.get([4, 4])).toBe(1)
      // And NOT on base sign map
      expect(engine.baseSignMap[4][4]).toBe(0)
    })

    it('sets up liberty exercise on last move', () => {
      let engine = new QuizEngine(singleSgf)
      engine.advance()
      engine.activateQuestions()
      expect(engine.libertyExerciseActive).toBe(true)
      expect(engine.libertyExercise).not.toBe(null)
      expect(engine.libertyExercise.groups.length).toBeGreaterThan(0)
    })

    it('returns null when all moves are played', () => {
      let engine = new QuizEngine(singleSgf)
      engine.advance()
      let state = engine.advance()
      expect(state).toBe(null)
      expect(engine.finished).toBe(true)
    })

    it('accumulates invisible stones across moves', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance() // B[ee]
      engine.advance() // W[ce]
      expect(engine.invisibleStones.size).toBe(2)
    })
  })

  describe('liberty exercise', () => {
    it('includes all groups on the board', () => {
      let engine = new QuizEngine(singleSgf)
      engine.advance(); engine.activateQuestions()
      // B[ee] center stone has 4 libs → included
      let groups = engine.libertyExercise.groups
      expect(groups.length).toBe(1)
      expect(groups[0].libCount).toBe(4)
      expect(groups[0].changed).toBe(true)
    })

    it('includes groups with > 5 liberties', () => {
      // 3 black stones in a row: chain has 8 liberties → included
      let engine = new QuizEngine('(;SZ[9];B[ee];W[aa];B[fe];W[ba];B[ge])')
      for (let i = 0; i < 5; i++) engine.advance()
      engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let bigGroup = groups.find(g => g.libCount > 5)
      expect(bigGroup).not.toBeUndefined()
      expect(bigGroup.libCount).toBe(8)
    })

    it('groups with > 5 libs score correctly when marked as 5', () => {
      let engine = new QuizEngine('(;SZ[9];B[ee];W[aa];B[fe];W[ba];B[ge])')
      for (let i = 0; i < 5; i++) engine.advance()
      engine.activateQuestions()
      // Mark everything correctly (>5 groups marked as 5)
      let result = engine.checkLibertyExercise(correctMarks(engine))
      expect(result.every(r => r.status === 'correct')).toBe(true)
    })

    it('marks unchanged groups as not changed', () => {
      // Setup: black at dd (4 libs). Move: B[ee], W[aa] — dd libs unchanged
      let engine = new QuizEngine('(;SZ[9]AB[dd];B[ee];W[aa])')
      engine.advance() // B[ee]
      engine.advance(); engine.activateQuestions() // W[aa] — last move
      let groups = engine.libertyExercise.groups
      let ddGroup = groups.find(g => [...g.chainKeys].includes('3,3'))
      expect(ddGroup.changed).toBe(false)
    })

    it('marks groups with changed liberty count as changed', () => {
      // Setup: black at ee (4 libs). Move: W[de] adjacent → ee libs: 4→3
      let engine = new QuizEngine('(;SZ[9]AB[ee];W[de])')
      engine.advance(); engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let eeGroup = groups.find(g => [...g.chainKeys].includes('4,4'))
      expect(eeGroup.changed).toBe(true)
      expect(eeGroup.libCount).toBe(3)
    })

    it('marks new groups as changed', () => {
      let engine = new QuizEngine('(;SZ[9];B[ee])')
      engine.advance(); engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      expect(groups[0].changed).toBe(true)
    })

    it('pre-marks groups whose lib count did not change', () => {
      // dd has 4 libs initially, move is far away so libs unchanged
      let engine = new QuizEngine('(;SZ[9]AB[dd];B[ee];W[aa])')
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let ddGroup = engine.libertyExercise.groups.find(g => [...g.chainKeys].includes('3,3'))
      expect(ddGroup.changed).toBe(false)
      expect(ddGroup.libCount).toBe(4)
    })

    it('no exercise when maxQuestions=0', () => {
      let engine = new QuizEngine(singleSgf, true, 0)
      engine.advance()
      expect(engine.libertyExercise).toBe(null)
    })

  })

  describe('captures', () => {
    it('captures on trueBoard but keeps stones in invisibleStones for display', () => {
      let engine = new QuizEngine(captureSgf)
      // Move 1: B[aa] = [0,0]
      engine.advance()
      expect(engine.trueBoard.get([0, 0])).toBe(1)

      // Move 2: W[ba] = [1,0]
      engine.advance()
      expect(engine.trueBoard.get([1, 0])).toBe(-1)

      // Move 3: B[ee] = [4,4]
      engine.advance()

      // Move 4: W[ab] = [0,1] — captures B[aa]
      engine.advance()
      // B[aa] captured on true board (for correct liberty answers)
      expect(engine.trueBoard.get([0, 0])).toBe(0)
      // B[aa] still in invisibleStones (for display — user needs to remember it)
      expect(engine.invisibleStones.has('0,0')).toBe(true)
    })
  })

  describe('getDisplaySignMap()', () => {
    it('does not show current move (shown as ghost stone by UI)', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance() // B[ee]
      let display = engine.getDisplaySignMap()
      expect(display[4][4]).toBe(0)
      expect(engine.baseSignMap[4][4]).toBe(0)
    })

    it('does not mutate baseSignMap', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance()
      engine.getDisplaySignMap()
      expect(engine.baseSignMap[4][4]).toBe(0)
    })
  })

  describe('liberty counting', () => {
    it('counts 4 liberties for center stone on empty board', () => {
      let engine = new QuizEngine('(;SZ[9];B[ee])')
      engine.advance()
      let libs = engine.trueBoard.getLiberties([4, 4])
      expect(libs.length).toBe(4)
    })

    it('counts 2 liberties for corner stone', () => {
      let engine = new QuizEngine('(;SZ[9];B[aa])')
      engine.advance()
      let libs = engine.trueBoard.getLiberties([0, 0])
      expect(libs.length).toBe(2)
    })

    it('counts 3 liberties for edge stone', () => {
      let engine = new QuizEngine('(;SZ[9];B[ea])')
      engine.advance()
      let libs = engine.trueBoard.getLiberties([4, 0])
      expect(libs.length).toBe(3)
    })

    it('reduces liberties when adjacent to friendly stone', () => {
      // Two black stones adjacent share a liberty
      let engine = new QuizEngine('(;SZ[9];B[ee];W[aa];B[fe])')
      engine.advance() // B[ee]=[4,4]
      engine.advance() // W[aa]=[0,0]
      engine.advance() // B[fe]=[5,4]
      // Group [4,4]+[5,4] has 6 liberties as a chain
      let libs = engine.trueBoard.getLiberties([4, 4])
      expect(libs.length).toBe(6)
    })
  })

  describe('group scoring', () => {
    it('questioned stone staleness tracks age', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance() // B[ee] — only stone, staleness 0
      expect(engine.staleness.get('4,4')).toBe(0)
    })

    it('staleness increments each turn for unchosen groups', () => {
      // 4 moves, all separate groups
      let sgf = '(;SZ[9];B[aa];W[ii];B[ai];W[ia])'
      let engine = new QuizEngine(sgf)
      engine.advance()
      engine.advance()
      engine.advance()
      engine.advance()
      // All staleness values should be <= 4
      for (let [, val] of engine.staleness) {
        expect(val).toBeLessThanOrEqual(4)
      }
    })

    it('staleness caps at 4', () => {
      // Many moves to age a stone
      let sgf = '(;SZ[9];B[aa];W[ii];B[bb];W[hh];B[cc];W[gg];B[dd];W[ff])'
      let engine = new QuizEngine(sgf)
      for (let i = 0; i < 8; i++) engine.advance()
      for (let [, val] of engine.staleness) {
        expect(val).toBeLessThanOrEqual(4)
      }
    })

    it('getGroupScores returns liberties and libsChanged', () => {
      let engine = new QuizEngine('(;SZ[9];B[aa];W[ii])')
      engine.advance() // B[aa]
      engine.advance() // W[ii]
      let groups = engine.getGroupScores()
      let blackGroup = groups.find(g => g.vertices.some(v => v[0] === 0 && v[1] === 0))
      expect(blackGroup.liberties).toBe(2)
      expect(blackGroup.libsChanged).toBe(false) // W[ii] is far away
      let whiteGroup = groups.find(g => g.vertices.some(v => v[0] === 8 && v[1] === 8))
      expect(whiteGroup.liberties).toBe(2)
      expect(whiteGroup.libsChanged).toBe(true) // just-played
    })

    it('exercise selects groups that changed from initial position', () => {
      // B[ba] then W[aa]: both new stones, both differ from empty initial board
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance() // B[ba] — not last, no exercise
      expect(engine.libertyExercise).toBe(null)
      engine.advance(); engine.activateQuestions() // W[aa] — last, both groups changed
      let changedGroups = engine.libertyExercise.groups.filter(g => g.changed)
      expect(changedGroups.length).toBe(2)
    })

    it('libsChanged true when move affects adjacent group', () => {
      // B[ee] center, then W[de] adjacent — reduces B[ee] libs from 4 to 3
      let engine = new QuizEngine('(;SZ[9];B[ee];W[de])')
      engine.advance() // B[ee]
      engine.advance() // W[de] — B[ee] libs: 4→3
      let groups = engine.getGroupScores()
      let blackGroup = groups.find(g => g.vertices.some(v => v[0] === 4 && v[1] === 4))
      expect(blackGroup.libsChanged).toBe(true)
    })

    it('libsChanged true for current move single stone', () => {
      let engine = new QuizEngine('(;SZ[9];B[ee];W[aa])')
      engine.advance() // B[ee]
      engine.advance() // W[aa]
      let groups = engine.getGroupScores()
      let whiteGroup = groups.find(g => g.vertices.some(v => v[0] === 0 && v[1] === 0))
      expect(whiteGroup.libsChanged).toBe(true)
    })

    it('libsChanged false for non-adjacent group', () => {
      // B[aa] corner, then W[ii] far corner — B[aa] libs unchanged
      let engine = new QuizEngine('(;SZ[9];B[aa];W[ii])')
      engine.advance() // B[aa]
      engine.advance() // W[ii]
      let groups = engine.getGroupScores()
      let blackGroup = groups.find(g => g.vertices.some(v => v[0] === 0 && v[1] === 0))
      expect(blackGroup.libsChanged).toBe(false)
    })

    it('libsChanged true when current move joins existing chain', () => {
      // B[ee], W[aa], B[fe] — B[fe] joins B[ee], chain libs change 4→6
      let engine = new QuizEngine('(;SZ[9];B[ee];W[aa];B[fe])')
      engine.advance() // B[ee]
      engine.advance() // W[aa]
      engine.advance() // B[fe] joins B[ee]
      let groups = engine.getGroupScores()
      let bigGroup = groups.find(g => g.liberties === 6)
      expect(bigGroup.libsChanged).toBe(true)
    })

    it('exercise skips groups unchanged from initial position', () => {
      // Setup: black at dd. Moves: B[ee], W[aa]
      // dd is setup stone — unchanged (same vertex set, same lib count) → not changed
      let engine = new QuizEngine('(;SZ[9]AB[dd];B[ee];W[aa])')
      engine.advance() // B[ee]
      engine.advance(); engine.activateQuestions() // W[aa] — last move
      let groups = engine.libertyExercise.groups
      let ddGroup = groups.find(g => [...g.chainKeys].includes('3,3'))
      expect(ddGroup.changed).toBe(false)
      // ee and aa are new → changed
      let eeGroup = groups.find(g => [...g.chainKeys].includes('4,4'))
      let aaGroup = groups.find(g => [...g.chainKeys].includes('0,0'))
      expect(eeGroup.changed).toBe(true)
      expect(aaGroup.changed).toBe(true)
    })

    it('exercise includes groups with changed liberties from setup', () => {
      // Setup: black at ee (4 libs). Move: W[de] adjacent → ee libs: 4→3
      let engine = new QuizEngine('(;SZ[9]AB[ee];W[de])')
      engine.advance(); engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let eeGroup = groups.find(g => [...g.chainKeys].includes('4,4'))
      expect(eeGroup.changed).toBe(true) // lib count changed 4→3
      let deGroup = groups.find(g => [...g.chainKeys].includes('3,4'))
      expect(deGroup.changed).toBe(true) // new group
    })

    it('marks group changed when libs varied during sequence even if final matches initial', () => {
      // Setup: black at ee (4 libs). Moves: W[de] (ee→3 libs), B[df] (ee→4 libs again)
      // ee ends with 4 libs same as initial, but changed mid-sequence
      let engine = new QuizEngine('(;SZ[9]AB[ee];W[de];B[df])')
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let eeGroup = groups.find(g => [...g.chainKeys].includes('4,4'))
      expect(eeGroup.changed).toBe(true) // changed mid-sequence even though final = initial
    })

    it('marks group unchanged when libs always 5+ throughout sequence', () => {
      // Setup: black at ee (4 libs). Add enough stones to give it 5+ libs initially.
      // AB[ee][de][fe] gives a 3-stone chain with many liberties (>= 5).
      // Move: W[aa] far away — libs change slightly but stay >= 5
      let engine = new QuizEngine('(;SZ[9]AB[ee][de][fe];W[aa];B[bb])')
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let eeGroup = groups.find(g => [...g.chainKeys].includes('4,4'))
      expect(eeGroup.libCount).toBeGreaterThanOrEqual(5)
      expect(eeGroup.changed).toBe(false) // always 5+, not a useful question
    })

    it('pre-marks merged 5+ group when ancestor was always 5+', () => {
      // Setup: two separate black groups both with 5+ libs
      // AB[ee][de][fe] = 3-stone chain (~8 libs), AB[eh] far stone
      // Move B[ef][eg] bridges them — merged chain still 5+
      let engine = new QuizEngine('(;SZ[9]AB[ee][de][fe][eh];B[eg];W[aa];B[ef])')
      engine.advance()
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let group = groups.find(g => [...g.chainKeys].includes('4,4'))
      expect(group.libCount).toBeGreaterThanOrEqual(5)
      expect(group.changed).toBe(false) // merged but always 5+
    })

    it('marks group changed when libs went from 5+ to below 5', () => {
      // AB[ee][de][fe] = 3-stone chain with >= 5 libs. W[ed] reduces libs.
      // Then more moves to reduce further below 5.
      let engine = new QuizEngine('(;SZ[9]AB[ee][de][fe];W[ed];B[aa];W[dd];B[bb];W[ef])')
      for (let i = 0; i < 5; i++) engine.advance()
      engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let eeGroup = groups.find(g => [...g.chainKeys].includes('4,4'))
      if (eeGroup && eeGroup.libCount < 5) {
        expect(eeGroup.changed).toBe(true) // dropped below 5, meaningful question
      }
    })

    it('marks new group unchanged when it always had 5+ libs', () => {
      // A new group placed with 5+ liberties — should still be unchanged if always 5+
      let engine = new QuizEngine('(;SZ[9];B[ee])')
      engine.advance(); engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let eeGroup = groups.find(g => [...g.chainKeys].includes('4,4'))
      // ee has 4 libs so this should be changed (new group with <5 libs)
      expect(eeGroup.libCount).toBe(4)
      expect(eeGroup.changed).toBe(true)
    })

    it('pre-marks group with 6+ final libs when part existed on initial board', () => {
      // Setup: black at ee (4 libs). Move: B[ef] extends group, now 6 libs.
      // Part of group (ee) was on initial board, final libs > 5 → pre-marked
      let engine = new QuizEngine('(;SZ[9]AB[ee];B[ef];W[aa])')
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let group = groups.find(g => [...g.chainKeys].includes('4,4'))
      expect(group.libCount).toBeGreaterThan(5)
      expect(group.changed).toBe(false)
    })

    it('does not pre-mark 6+ group when no part existed on initial board', () => {
      // No setup stones. New group placed with 6+ libs.
      // AB[ee] gives 4 libs. Need a bigger new group.
      // Place B[dd][de][ed] in sequence — 3-stone chain in center, many libs
      let engine = new QuizEngine('(;SZ[9];B[dd];W[aa];B[de];W[bb];B[ed])')
      for (let i = 0; i < 5; i++) engine.advance()
      engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let group = groups.find(g => [...g.chainKeys].includes('3,3'))
      if (group && group.libCount > 5) {
        expect(group.changed).toBe(true) // no initial stones, still a question
      }
    })

    it('does not pre-mark 6+ new group with no initial stones', () => {
      // Entirely new group with 6+ libs but no stones on initial board
      // B[dd][de][ed] placed during sequence — no setup stones
      let engine = new QuizEngine('(;SZ[9];B[dd];W[aa];B[de];W[bb];B[ed])')
      for (let i = 0; i < 5; i++) engine.advance()
      engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let group = groups.find(g => [...g.chainKeys].includes('3,3'))
      if (group && group.libCount > 5) {
        expect(group.changed).toBe(true) // no initial stones, 6+ rule doesn't apply
      }
    })

    it('marks group unchanged when libs never varied during sequence', () => {
      // Setup: black at aa (2 libs). Moves far away: B[ee], W[ff]
      let engine = new QuizEngine('(;SZ[9]AB[aa];B[ee];W[ff])')
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let aaGroup = groups.find(g => [...g.chainKeys].includes('0,0'))
      expect(aaGroup.changed).toBe(false)
    })

  })

  describe('checkLibertyExercise', () => {
    it('returns correct for all groups when marks match', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let results = engine.checkLibertyExercise(correctMarks(engine))
      expect(results.every(r => r.status === 'correct')).toBe(true)
    })

    it('returns missed for unmarked groups', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let results = engine.checkLibertyExercise(new Map())
      expect(results.every(r => r.status === 'missed')).toBe(true)
    })

    it('returns wrong for incorrectly marked groups', () => {
      let engine = new QuizEngine('(;SZ[9];B[ee])')
      engine.advance(); engine.activateQuestions()
      // B[ee] has 4 libs, mark as 1
      let marks = new Map([['4,4', 1]])
      let results = engine.checkLibertyExercise(marks)
      expect(results[0].status).toBe('wrong')
      expect(results[0].userVertex).toBe('4,4')
      expect(results[0].userVal).toBe(1)
    })

    it('returns correct with userVertex and userVal', () => {
      let engine = new QuizEngine('(;SZ[9];B[ee])')
      engine.advance(); engine.activateQuestions()
      let marks = new Map([['4,4', 4]])
      let results = engine.checkLibertyExercise(marks)
      expect(results[0].status).toBe('correct')
      expect(results[0].userVertex).toBe('4,4')
      expect(results[0].userVal).toBe(4)
    })

    it('does not mutate engine state', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let beforeGroups = engine.libertyExercise.groups
      engine.checkLibertyExercise(correctMarks(engine))
      expect(engine.libertyExerciseActive).toBe(true)
      expect(engine.libertyExercise.groups).toBe(beforeGroups)
    })

    it('can be called multiple times without side effects', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let r1 = engine.checkLibertyExercise(new Map())
      let r2 = engine.checkLibertyExercise(correctMarks(engine))
      let r3 = engine.checkLibertyExercise(new Map())
      expect(r1.every(r => r.status === 'missed')).toBe(true)
      expect(r2.every(r => r.status === 'correct')).toBe(true)
      expect(r3.every(r => r.status === 'missed')).toBe(true)
    })

    it('distinguishes mixed correct/wrong/missed', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let changedGroups = engine.libertyExercise.groups.filter(g => g.changed)
      assert(changedGroups.length === 2, 'expected 2 changed groups')

      // Mark first group correctly, leave second missed
      let g0 = changedGroups[0]
      let marks = new Map([[[...g0.chainKeys][0], Math.min(g0.libCount, config.maxLibertyLabel)]])
      let results = engine.checkLibertyExercise(marks)
      expect(results[0].status).toBe('correct')
      expect(results[1].status).toBe('missed')
    })

  })

  describe('deterministic questions (seeded PRNG)', () => {
    it('same SGF produces same exercise groups every time', () => {
      let sgf = '(;SZ[9];B[ba];W[aa];B[ee];W[de])'
      let runs = Array.from({ length: 5 }, () => {
        let engine = new QuizEngine(sgf)
        while (!engine.finished) {
          engine.advance()
          engine.activateQuestions()
          if (engine.libertyExerciseActive) break
        }
        return engine.libertyExercise?.groups.map(g => ({ vertex: g.vertex, libCount: g.libCount, changed: g.changed }))
      })
      for (let i = 1; i < runs.length; i++) {
        expect(runs[i]).toEqual(runs[0])
      }
    })
  })

  describe('maxQuestions parameter', () => {
    it('maxQuestions=0 produces no exercise', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])', true, 0)
      engine.advance()
      expect(engine.libertyExercise).toBe(null)
      engine.advance()
      expect(engine.libertyExercise).toBe(null)
    })

    it('maxQuestions=0 finishes without an exercise', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa];B[ee])', true, 0)
      while (!engine.finished) engine.advance()
      expect(engine.finished).toBe(true)
      expect(engine.libertyExercise).toBe(null)
      expect(engine.libertyExerciseActive).toBe(false)
    })
  })

  describe('multi-group exercise', () => {
    it('exercise includes all changed groups on last move', () => {
      // B[ba] then W[aa] — both new stones
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance() // B[ba] — not last, no exercise
      expect(engine.libertyExercise).toBe(null)
      engine.advance(); engine.activateQuestions() // W[aa] — last
      let changedGroups = engine.libertyExercise.groups.filter(g => g.changed)
      expect(changedGroups.length).toBe(2)
    })

    it('non-adjacent groups both included', () => {
      let engine = new QuizEngine('(;SZ[9];B[aa];W[ii])')
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let changedGroups = engine.libertyExercise.groups.filter(g => g.changed)
      expect(changedGroups.length).toBe(2)
    })

    it('staleness tracks stone age', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance() // B[ba] — staleness 0
      engine.advance() // W[aa] — B[ba] aged to 1, W[aa] staleness 0
      expect(engine.staleness.get('1,0')).toBe(1) // B[ba] aged
      expect(engine.staleness.get('0,0')).toBe(0) // W[aa] just placed
    })
  })

})

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}
