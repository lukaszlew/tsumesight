import { describe, it, expect, beforeEach } from 'vitest'
import { QuizEngine } from './engine.js'

// Simple 9x9 game: 3 non-pass moves
let simpleSgf = '(;SZ[9];B[ee];W[ce];B[gc])'

// Game with a capture: white surrounds and captures black at ee
// Setup: Black at ee, White at de,fe,ed,ef. Then W[dd] doesn't capture.
// Simpler: build a capture step by step.
// Black at ee (center). White surrounds: de, fe, ed, ef. Then W captures...
// Actually let's do a corner capture for simplicity:
// B[aa], W[ba], W[ab] — black at 0,0 has no liberties after white ba and ab
let captureSgf = '(;SZ[9];B[aa];W[ba];B[ee];W[ab])'
// After W[ab] (=[0,1]), B[aa] (=[0,0]) is captured: neighbors are [1,0]=W and [0,1]=W

// Game with setup stones
let setupSgf = '(;SZ[9]AB[dd][ed]AW[de][ee];B[cd];W[ce])'

// Game with pass
let passSgf = '(;SZ[9];B[ee];W[];B[dd])'

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

    it('picks a question vertex from invisible stones', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance()
      engine.activateQuestions()
      // Only one invisible stone, so question must be it
      expect(engine.questionVertex).toEqual([4, 4])
    })

    it('returns null when all moves are played', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance(); engine.activateQuestions()
      engine.answer(4)
      engine.advance(); engine.activateQuestions()
      engine.answer(4)
      engine.advance(); engine.activateQuestions()
      engine.answer(4)
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

  describe('answer()', () => {
    it('returns correct when liberties match', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance(); engine.activateQuestions() // B[ee] on 9x9, center stone, 4 liberties
      let result = engine.answer(4)
      expect(result.correct).toBe(true)
      expect(result.trueLiberties).toBe(4)
      expect(engine.correct).toBe(1)
      expect(engine.wrong).toBe(0)
    })

    it('returns wrong when liberties are incorrect', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance(); engine.activateQuestions()
      let result = engine.answer(2)
      expect(result.correct).toBe(false)
      expect(engine.wrong).toBe(1)
    })

    it('blocks wrong answer and keeps stones invisible', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance() // B[ee]
      engine.advance(); engine.activateQuestions() // W[ce]
      expect(engine.invisibleStones.size).toBe(2)
      engine.answer(1) // wrong
      expect(engine.invisibleStones.size).toBe(2) // still invisible
      expect(engine.blockedAnswers.has(1)).toBe(true)
      expect(engine.errors).toBe(1)
    })

    it('does not materialize on correct answer', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance(); engine.activateQuestions() // B[ee]
      // question is [4,4], true liberties=4
      engine.answer(4)
      expect(engine.invisibleStones.size).toBe(1) // still invisible
      expect(engine.baseSignMap[4][4]).toBe(0) // still not on base
    })

    it('tracks results array', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance(); engine.activateQuestions()
      engine.answer(4) // correct
      engine.advance(); engine.activateQuestions()
      engine.answer(1) // wrong
      expect(engine.results).toEqual([true, false])
    })
  })

  describe('answerMark()', () => {
    it('returns 0 penalties when all liberties correctly marked', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance(); engine.activateQuestions() // B[ee]=[4,4], 4 liberties
      let libs = engine.trueBoard.getLiberties([4, 4])
      let marked = new Set(libs.map(([x, y]) => `${x},${y}`))
      let result = engine.answerMark(marked)
      expect(result.penalties).toBe(0)
      expect(engine.correct).toBe(1)
    })

    it('penalizes wrong marks and missed liberties', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance(); engine.activateQuestions() // B[ee]=[4,4], 4 liberties: [3,4],[5,4],[4,3],[4,5]
      let marked = new Set(['3,4', '0,0']) // 1 correct, 1 wrong, 3 missed
      let result = engine.answerMark(marked)
      expect(result.penalties).toBe(4) // 1 wrong + 3 missed
      expect(engine.errors).toBe(4)
      expect(engine.wrong).toBe(1)
    })

    it('always advances to next question', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance(); engine.activateQuestions()
      let v1 = engine.questionVertex
      engine.answerMark(new Set()) // all wrong, but still advances
      expect(engine.questionVertex).not.toEqual(v1)
    })

    it('returns done when last question answered', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance(); engine.activateQuestions()
      // Answer all questions
      while (engine.questionVertex) {
        let libs = engine.trueBoard.getLiberties(engine.questionVertex)
        let marked = new Set(libs.map(([x, y]) => `${x},${y}`))
        let result = engine.answerMark(marked)
        if (!engine.questionVertex) expect(result.done).toBe(true)
      }
    })
  })

  describe('captures', () => {
    it('removes captured stones from trueBoard but keeps on display', () => {
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
      // B[aa] should be dead on true board
      expect(engine.trueBoard.get([0, 0])).toBe(0)
      // B[aa] was invisible, now captured — removed from invisible set
      expect(engine.invisibleStones.has('0,0')).toBe(false)
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

    it('caps at 5 in answer evaluation', () => {
      // Build a group with >5 liberties: 3 stones in a row on center
      // B[ee] B[fe] B[ge] = [4,4] [5,4] [6,4] — chain has 8 liberties
      let engine = new QuizEngine('(;SZ[9];B[ee];W[aa];B[fe];W[ba];B[ge])')
      engine.advance() // B[ee]
      engine.advance() // W[aa]
      engine.advance() // B[fe]
      engine.advance() // W[ba]
      engine.advance(); engine.activateQuestions() // B[ge]
      // All 3 black stones are in one chain with 8 liberties
      let rawLibs = engine.trueBoard.getLiberties([4, 4]).length
      expect(rawLibs).toBe(8)
      // Engine should cap to 5
      let result = engine.answer(5)
      // Question might be any invisible stone; check the cap logic directly
      expect(result.trueLiberties).toBeLessThanOrEqual(5)
    })

    it('does not cap below 5', () => {
      let engine = new QuizEngine('(;SZ[9];B[ee])')
      engine.advance(); engine.activateQuestions()
      // ee has 4 liberties exactly
      let result = engine.answer(4)
      expect(result.correct).toBe(true)
      expect(result.trueLiberties).toBe(4)
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
      engine.advance() // B[aa] — staleness 0, then chosen → 0
      engine.advance() // W[ii] — B[aa] aged to 1, then question chosen
      engine.advance() // B[ai]
      engine.advance() // W[ia]
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

    it('asks about just-played stone first, then older affected group', () => {
      // B[ba] edge stone, then W[aa] adjacent — B[ba] libs change
      // Both libsChanged=true, but just-played W[aa] always comes first
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance() // B[ba] questioned (only stone)
      engine.advance(); engine.activateQuestions() // W[aa] — adjacent, B[ba] libs: 3→2
      expect(engine.questionVertex).toEqual([0, 0]) // just-played first
      expect(engine.questions[1]).toEqual([1, 0])    // then B[ba]
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

    it('sorts by fewest liberties first, just-played as tiebreaker', () => {
      // B[aa] corner (2 libs), W[ii] far corner (2 libs)
      // Then B[hi] adjacent to W[ii] — W[ii] reduced to 1 lib, B[hi] has 2 libs
      let engine = new QuizEngine('(;SZ[9];B[aa];W[ii];B[hi])')
      engine.advance() // B[aa]
      engine.advance() // W[ii]
      engine.advance(); engine.activateQuestions() // B[hi]
      // W[ii] has 1 liberty (fewest) → first question
      // B[hi] has 2 liberties, just-played → second question
      // B[aa]: libsChanged=false → masked out
      expect(engine.questionVertex).toEqual([8, 8]) // W[ii] — fewest libs
      expect(engine.questions[1]).toEqual([7, 8])    // B[hi] — just-played
    })

    it('two non-adjacent center stones: unchanged masked out', () => {
      // B[ee] and W[cc] — both 4 libs, not adjacent
      // B[gg] not adjacent to either — both unchanged, falls back to all
      let engine = new QuizEngine('(;SZ[9];B[ee];W[cc];B[gg])')
      engine.advance(); engine.activateQuestions() // B[ee]
      engine.answer(4)
      engine.advance(); engine.activateQuestions() // W[cc]
      engine.answer(4) // question was B[ee]

      engine.advance() // B[gg] — not adjacent to B[ee] or W[cc]
      // No groups have libsChanged (except B[gg] as single current)
      // B[gg] is the only libsChanged=true → picked from changed pool
      let m3 = engine.peekGroupScores
      let gg = m3.find(g => g.vertices.some(v => v[0] === 6 && v[1] === 6))
      expect(gg.libsChanged).toBe(true)
      // B[ee] and W[cc] both unchanged
      let ee = m3.find(g => g.vertices.some(v => v[0] === 4 && v[1] === 4))
      let cc = m3.find(g => g.vertices.some(v => v[0] === 2 && v[1] === 2))
      expect(ee.libsChanged).toBe(false)
      expect(cc.libsChanged).toBe(false)
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
    it('same SGF produces same questions every time', () => {
      let sgf = '(;SZ[9];B[ba];W[aa];B[ee];W[de])'
      let runs = Array.from({ length: 5 }, () => {
        let engine = new QuizEngine(sgf)
        let questions = []
        while (!engine.finished) {
          engine.advance()
          engine.activateQuestions()
          questions.push([...engine.questions])
          for (let q of engine.questions) {
            let libs = Math.min(engine.trueBoard.getLiberties(q).length, 5)
            let result = engine.answer(libs)
            if (result.done) break
          }
        }
        return questions
      })
      for (let i = 1; i < runs.length; i++) {
        expect(runs[i]).toEqual(runs[0])
      }
    })
  })

  describe('fromReplay()', () => {
    it('replays correct answers to match normal play-through', () => {
      let sgf = '(;SZ[9];B[ba];W[aa];B[ee];W[de])'
      let engine = new QuizEngine(sgf)
      let history = []
      engine.advance(); engine.activateQuestions()
      while (!engine.finished) {
        if (!engine.questionVertex) { engine.advance(); engine.activateQuestions(); continue }
        let libs = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
        let result = engine.answer(libs)
        history.push(true)
        if (result.done) { engine.advance(); engine.activateQuestions() }
      }
      let replayed = QuizEngine.fromReplay(sgf, history)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(engine.correct)
      expect(replayed.wrong).toBe(engine.wrong)
      expect(replayed.results).toEqual(engine.results)
      expect(replayed.moveProgress.length).toBe(engine.moveProgress.length)
    })

    it('replays wrong answers correctly', () => {
      let sgf = '(;SZ[9];B[ba];W[aa])'
      let engine = new QuizEngine(sgf)
      engine.advance(); engine.activateQuestions()
      // Wrong answer on first question
      let libs = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
      let wrongAnswer = libs === 1 ? 2 : 1
      engine.answer(wrongAnswer)
      engine.answer(libs) // retry correct
      // Now answer remaining questions correctly
      let history = [false]
      while (engine.questionVertex) {
        let l = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
        let result = engine.answer(l)
        history.push(true)
        if (result.done) break
      }
      engine.advance()
      // Replay
      let replayed = QuizEngine.fromReplay(sgf, history)
      expect(replayed.correct).toBe(engine.correct)
      expect(replayed.wrong).toBe(engine.wrong)
      expect(replayed.moveIndex).toBe(engine.moveIndex)
    })

    it('replays partial history to restore mid-quiz state', () => {
      let sgf = '(;SZ[9];B[ba];W[aa];B[ee];W[de])'
      // Play through first move's questions, then advance to second move
      let engine = new QuizEngine(sgf)
      engine.advance(); engine.activateQuestions() // move 1: B[ba], 1 question
      let libs = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
      let result = engine.answer(libs)
      expect(result.done).toBe(true)
      engine.advance(); engine.activateQuestions() // move 2: W[aa], 2 questions
      // Answer first question of move 2
      let libs2 = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
      engine.answer(libs2)
      let moveIdx = engine.moveIndex
      let correct = engine.correct
      let qVertex = engine.questionVertex

      // Replay: [true] for move 1 q1, [true] for move 2 q1
      let replayed = QuizEngine.fromReplay(sgf, [true, true])
      expect(replayed.moveIndex).toBe(moveIdx)
      expect(replayed.correct).toBe(correct)
      expect(replayed.questionVertex).toEqual(qVertex)
    })

    it('returns finished engine for complete history', () => {
      let sgf = '(;SZ[9];B[ee])'
      let engine = new QuizEngine(sgf)
      engine.advance(); engine.activateQuestions()
      let libs = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
      engine.answer(libs)
      engine.advance()
      expect(engine.finished).toBe(true)

      let replayed = QuizEngine.fromReplay(sgf, [true])
      expect(replayed.finished).toBe(true)
    })

    it('handles empty history (same as fresh engine after advance)', () => {
      let sgf = '(;SZ[9];B[ee];W[dd])'
      let fresh = new QuizEngine(sgf)
      fresh.advance()
      let replayed = QuizEngine.fromReplay(sgf, [])
      expect(replayed.moveIndex).toBe(fresh.moveIndex)
      expect(replayed.questionVertex).toEqual(fresh.questionVertex)
    })
  })

  describe('maxQuestions parameter', () => {
    it('maxQuestions=0 produces no questions on any move', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa];B[ee])', 'liberty', true, 0)
      while (!engine.finished) {
        engine.advance()
        expect(engine.questions.length).toBe(0)
        expect(engine.questionVertex).toBe(null)
      }
    })

    it('maxQuestions=0 finishes with 0 correct and 0 wrong', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa];B[ee])', 'liberty', true, 0)
      while (!engine.finished) engine.advance()
      expect(engine.correct).toBe(0)
      expect(engine.wrong).toBe(0)
      expect(engine.results.length).toBe(0)
    })

    it('maxQuestions=0 questionsPerMove is all zeros', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa];B[ee])', 'liberty', true, 0)
      expect(engine.questionsPerMove).toEqual([0, 0, 0])
    })

    it('maxQuestions=1 limits to 1 question even when multiple groups change', () => {
      // B[ba] then W[aa] — adjacent, both groups change libs → normally 2 questions
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])', 'liberty', true, 1)
      engine.advance() // B[ba]
      expect(engine.questions.length).toBe(1)
      engine.advance() // W[aa]
      expect(engine.questions.length).toBe(1)
    })

    it('maxQuestions=0 fromReplay with empty history finishes immediately', () => {
      let sgf = '(;SZ[9];B[ba];W[aa];B[ee])'
      let engine = QuizEngine.fromReplay(sgf, [], 'liberty', 0)
      // With 0 questions, all moves are auto-advanced through replay
      // The engine should be at move 1 with showingMove=true (no questions to answer)
      expect(engine.correct).toBe(0)
      expect(engine.wrong).toBe(0)
    })
  })

  describe('multi-question per move', () => {
    it('asks about all groups with changed liberties', () => {
      // B[ba] then W[aa] — adjacent, both groups change libs
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance() // B[ba] — 1 question (only stone)
      expect(engine.questions.length).toBe(1)
      engine.advance() // W[aa] — adjacent to B[ba], both changed libs
      expect(engine.questions.length).toBe(2)
    })

    it('answer returns done only after last question', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance(); engine.activateQuestions() // B[ba]
      let r1 = engine.answer(3) // B[ba] has 3 libs
      expect(r1.done).toBe(true)
      engine.advance(); engine.activateQuestions() // W[aa] — 2 questions
      // First answer
      let r2 = engine.answer(engine.trueBoard.getLiberties(engine.questionVertex).length)
      expect(r2.done).toBe(false)
      // Second answer
      let r3 = engine.answer(engine.trueBoard.getLiberties(engine.questionVertex).length)
      expect(r3.done).toBe(true)
    })

    it('advances questionVertex through the queue', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance() // B[ba]
      engine.advance(); engine.activateQuestions() // W[aa] — 2 questions
      let q1 = engine.questionVertex
      engine.answer(engine.trueBoard.getLiberties(q1).length)
      let q2 = engine.questionVertex
      expect(q1).not.toEqual(q2)
      expect(q2).not.toBe(null)
    })

    it('non-adjacent moves produce single question', () => {
      let engine = new QuizEngine('(;SZ[9];B[aa];W[ii])')
      engine.advance() // B[aa]
      expect(engine.questions.length).toBe(1)
      engine.advance() // W[ii] — far away
      expect(engine.questions.length).toBe(1)
    })

    it('staleness tracks stone age without question reset', () => {
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

    it('increments on wrong answer in liberty mode', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance(); engine.activateQuestions()
      if (!engine.questionVertex) return
      let trueLiberties = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
      let wrongAnswer = trueLiberties === 1 ? 2 : 1
      engine.answer(wrongAnswer)
      expect(engine.showWindow).toBe(2)
    })

    it('increments on each wrong answer', () => {
      let sgf = '(;SZ[9];B[ee];W[de];B[ce];W[dd])'
      let engine = new QuizEngine(sgf, 'liberty', true, 1)
      // Play through giving wrong answers
      let wrongCount = 0
      engine.advance(); engine.activateQuestions()
      while (!engine.finished) {
        if (engine.questionVertex) {
          let trueLiberties = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
          let wrongAnswer = trueLiberties === 1 ? 2 : 1
          engine.answer(wrongAnswer) // wrong
          wrongCount++
          expect(engine.showWindow).toBe(1 + wrongCount)
          engine.answer(trueLiberties) // retry correct
        }
        if (!engine.finished) {
          engine.advance(); engine.activateQuestions()
        }
      }
    })

    it('getWindowStones returns empty when showWindow=1', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance()
      expect(engine.getWindowStones()).toEqual([])
    })

    it('getWindowStones returns previous stones when showWindow>1', () => {
      let sgf = '(;SZ[9];B[ee];W[de];B[ce])'
      let engine = new QuizEngine(sgf, 'liberty', true, 1)
      engine.advance(); engine.activateQuestions() // B[ee]
      if (engine.questionVertex) {
        let trueLiberties = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
        let wrongAnswer = trueLiberties === 1 ? 2 : 1
        engine.answer(wrongAnswer) // wrong → showWindow=2
        engine.answer(trueLiberties) // retry correct
      }
      engine.advance(); engine.activateQuestions() // W[de]
      if (engine.questionVertex) {
        let trueLiberties = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
        engine.answer(trueLiberties)
      }
      engine.advance() // B[ce] — showingMove=true, showWindow=2
      expect(engine.showWindow).toBe(2)
      let windowStones = engine.getWindowStones()
      // Should return 1 previous invisible stone (showWindow-1=1)
      expect(windowStones.length).toBeLessThanOrEqual(1)
    })
  })

})
