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
      engine.advance(); engine.activateQuestions()
      engine.submitLibertyExercise(correctMarks(engine))
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
      let result = engine.submitLibertyExercise(correctMarks(engine))
      expect(result.correctCount).toBe(result.total)
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

    it('submitLibertyExercise scores correctly', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let changedGroups = engine.libertyExercise.groups.filter(g => g.changed)
      expect(changedGroups.length).toBe(2)

      let result = engine.submitLibertyExercise(correctMarks(engine))
      expect(result.correctCount).toBe(2)
      expect(result.wrongCount).toBe(0)
      expect(engine.correct).toBe(2)
    })

    it('submitLibertyExercise detects wrong marks', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance()
      engine.advance(); engine.activateQuestions()

      // Mark nothing → all missed
      let result = engine.submitLibertyExercise(new Map())
      let changedCount = engine.libertyExercise.groups.filter(g => g.changed).length
      expect(result.wrongCount).toBe(changedCount)
      expect(result.correctCount).toBe(0)
      expect(engine.wrong).toBe(changedCount)
    })

    it('submitLibertyExercise deactivates exercise', () => {
      let engine = new QuizEngine(singleSgf)
      engine.advance(); engine.activateQuestions()
      expect(engine.libertyExerciseActive).toBe(true)
      engine.submitLibertyExercise(new Map())
      expect(engine.libertyExerciseActive).toBe(false)
    })

    it('resolves marks by chain membership', () => {
      // B[ee] then W[de]: B has chain {ee}, W has chain {de}
      let engine = new QuizEngine('(;SZ[9];B[ee];W[de])')
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let bGroup = groups.find(g => [...g.chainKeys].includes('4,4'))
      let wGroup = groups.find(g => [...g.chainKeys].includes('3,4'))

      // Mark B correctly, W with wrong number
      let marks = new Map()
      marks.set('4,4', Math.min(bGroup.libCount, 6))
      let wrongNum = Math.min(wGroup.libCount, 6) === 1 ? 2 : 1
      marks.set('3,4', wrongNum)

      let result = engine.submitLibertyExercise(marks)
      expect(result.correctCount).toBe(1) // B correct
      expect(result.wrongCount).toBe(1) // W wrong number
    })

    it('accepts any stone in the chain as a valid mark', () => {
      // B[ee] then W[de] then B[ed]: B chain ee+ed has 5 libs
      let engine = new QuizEngine('(;SZ[9];B[ee];W[de];B[ed])')
      engine.advance(); engine.advance(); engine.advance()
      engine.activateQuestions()
      let groups = engine.libertyExercise.groups
      let bGroup = groups.find(g => [...g.chainKeys].includes('4,4'))
      assert(bGroup, 'should find black group')
      expect([...bGroup.chainKeys]).toContain('4,3')

      // Mark via ed=[4,3] (not the representative vertex necessarily)
      let marks = new Map()
      marks.set('4,3', Math.min(bGroup.libCount, 6))
      // Mark other changed groups correctly too
      for (let g of groups.filter(g => g.changed && g !== bGroup))
        marks.set([...g.chainKeys][0], Math.min(g.libCount, config.maxLibertyLabel))
      engine.submitLibertyExercise(marks)
      let bIdx = groups.filter(g => g.changed).indexOf(bGroup)
      expect(engine.results[bIdx]).toBe(true)
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

    it('clears staleness on materialize', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance()
      engine.advance()
      expect(engine.staleness.size).toBe(2)
      engine.materialize()
      expect(engine.staleness.size).toBe(0)
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

  describe('fromReplay()', () => {
    it('replays all correct answers to match normal play-through', () => {
      let sgf = '(;SZ[9];B[ba];W[aa];B[ee];W[de])'
      let engine = new QuizEngine(sgf)
      while (!engine.finished) {
        engine.advance()
        engine.activateQuestions()
        if (engine.libertyExerciseActive) break
      }
      engine.submitLibertyExercise(correctMarks(engine))
      let changedGroups = engine.libertyExercise.groups.filter(g => g.changed)
      engine.advance()
      expect(engine.finished).toBe(true)

      let history = changedGroups.map(() => true)
      let replayed = QuizEngine.fromReplay(sgf, history)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(engine.correct)
      expect(replayed.wrong).toBe(engine.wrong)
      expect(replayed.results).toEqual(engine.results)
    })

    it('replays wrong answers correctly', () => {
      let sgf = '(;SZ[9];B[ba];W[aa])'
      let engine = new QuizEngine(sgf)
      engine.advance()
      engine.advance(); engine.activateQuestions()
      let changedGroups = engine.libertyExercise.groups.filter(g => g.changed)

      // All wrong (no marks)
      engine.submitLibertyExercise(new Map())
      engine.advance()

      let history = changedGroups.map(() => false)
      let replayed = QuizEngine.fromReplay(sgf, history)
      expect(replayed.correct).toBe(engine.correct)
      expect(replayed.wrong).toBe(engine.wrong)
    })

    it('returns finished engine for complete history', () => {
      let sgf = '(;SZ[9];B[ee])'
      let replayed = QuizEngine.fromReplay(sgf, [true])
      expect(replayed.finished).toBe(true)
    })

    it('handles empty history (advances all moves, shows last move)', () => {
      let sgf = '(;SZ[9];B[ee];W[dd])'
      let replayed = QuizEngine.fromReplay(sgf, [])
      // All moves advanced, but exercise not submitted yet
      expect(replayed.moveIndex).toBe(2)
      expect(replayed.showingMove).toBe(true)
      expect(replayed.finished).toBe(false)
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

    it('maxQuestions=0 finishes with 0 correct and 0 wrong', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa];B[ee])', true, 0)
      while (!engine.finished) engine.advance()
      expect(engine.correct).toBe(0)
      expect(engine.wrong).toBe(0)
      expect(engine.results.length).toBe(0)
    })

    it('maxQuestions=0 questionsPerMove is all zeros', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])', true, 0)
      expect(engine.questionsPerMove).toEqual([0, 0])
    })

    it('maxQuestions=0 fromReplay with empty history finishes immediately', () => {
      let sgf = '(;SZ[9];B[ba];W[aa];B[ee])'
      let engine = QuizEngine.fromReplay(sgf, [], 0)
      expect(engine.correct).toBe(0)
      expect(engine.wrong).toBe(0)
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

  describe('show window', () => {
    it('starts at 1', () => {
      let engine = new QuizEngine(simpleSgf)
      expect(engine.showWindow).toBe(1)
    })

    it('getWindowStones returns empty when showWindow=1', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance()
      expect(engine.getWindowStones()).toEqual([])
    })
  })

  describe('hint states', () => {
    // At every point in a quiz session, exactly one hint condition should be active:
    // 1. showingMove (not finished, not exercising) → "Tap board for the next move"
    // 2. libertyExerciseActive → "Mark groups by liberty count"
    // 3. finished → stats/buttons (no action hint)
    function hintState(engine) {
      if (engine.finished) return 'finished'
      if (engine.libertyExerciseActive) return 'exercise'
      return 'advance'
    }

    it('every state in a full session maps to exactly one hint', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      let states = []
      engine.advance()
      states.push(hintState(engine)) // advance (showingMove)
      engine.activateQuestions()
      while (!engine.finished) {
        let s = hintState(engine)
        states.push(s)
        if (s === 'exercise') {
          engine.submitLibertyExercise(correctMarks(engine))
          engine.advance()
        } else {
          engine.advance()
          engine.activateQuestions()
        }
      }
      states.push(hintState(engine))

      expect(states.includes('advance')).toBe(true)
      expect(states.includes('exercise')).toBe(true)
      expect(states.includes('finished')).toBe(true)
      for (let s of states) expect(['advance', 'exercise', 'finished']).toContain(s)
    })
  })

})

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}
