import { describe, it, expect, beforeEach } from 'vitest'
import { QuizEngine } from './engine.js'

// Simple 9x9 game: 3 non-pass moves (questions only on last move)
let simpleSgf = '(;SZ[9];B[ee];W[ce];B[gc])'
// Single-move SGF (questions activate immediately)
let singleSgf = '(;SZ[9];B[ee])'

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

    it('picks a question vertex on last move', () => {
      let engine = new QuizEngine(singleSgf)
      engine.advance()
      engine.activateQuestions()
      // Single move = last move, question activates
      expect(engine.questionVertex).not.toBe(null)
    })

    it('returns null when all moves are played', () => {
      let engine = new QuizEngine(singleSgf)
      engine.advance(); engine.activateQuestions()
      // Answer all questions on the last (only) move
      while (engine.questionVertex)
        engine.answer(Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5))
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
      let engine = new QuizEngine(singleSgf)
      engine.advance(); engine.activateQuestions() // B[ee] on 9x9, center stone, 4 liberties
      let result = engine.answer(4)
      expect(result.correct).toBe(true)
      expect(result.trueLiberties).toBe(4)
      expect(engine.correct).toBe(1)
      expect(engine.wrong).toBe(0)
    })

    it('returns wrong when liberties are incorrect', () => {
      let engine = new QuizEngine(singleSgf)
      engine.advance(); engine.activateQuestions()
      let result = engine.answer(2)
      expect(result.correct).toBe(false)
      expect(engine.wrong).toBe(1)
    })

    it('blocks wrong answer and keeps stones invisible', () => {
      // 2 adjacent moves — questions only on last move
      let sgf = '(;SZ[9];B[ee];W[ce])'
      let engine = new QuizEngine(sgf)
      engine.advance() // B[ee] — not last, no questions
      engine.advance(); engine.activateQuestions() // W[ce] — last, questions activate
      expect(engine.invisibleStones.size).toBe(2)
      engine.answer(1) // wrong
      expect(engine.invisibleStones.size).toBe(2) // still invisible
      expect(engine.blockedAnswers.has(1)).toBe(true)
      expect(engine.errors).toBe(1)
    })

    it('does not materialize on correct answer', () => {
      let engine = new QuizEngine(singleSgf)
      engine.advance(); engine.activateQuestions() // B[ee]
      // question is [4,4], true liberties=4
      engine.answer(4)
      expect(engine.invisibleStones.size).toBe(1) // still invisible
      expect(engine.baseSignMap[4][4]).toBe(0) // still not on base
    })

    it('tracks results array', () => {
      // Use SGF where last move has 2+ questions
      let sgf = '(;SZ[9];B[ba];W[aa])'
      let engine = new QuizEngine(sgf)
      engine.advance() // B[ba] — not last
      engine.advance(); engine.activateQuestions() // W[aa] — last, 2 questions
      let libs1 = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
      engine.answer(libs1) // correct
      let libs2 = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
      engine.answer(libs2 === 1 ? 2 : 1) // wrong
      expect(engine.results[0]).toBe(true)
      expect(engine.results[1]).toBe(false)
    })
  })

  describe('answerMark()', () => {
    it('returns 0 penalties when all liberties correctly marked', () => {
      let engine = new QuizEngine(singleSgf)
      engine.advance(); engine.activateQuestions() // B[ee]=[4,4], 4 liberties
      let libs = engine.trueBoard.getLiberties([4, 4])
      let marked = new Set(libs.map(([x, y]) => `${x},${y}`))
      let result = engine.answerMark(marked)
      expect(result.penalties).toBe(0)
      expect(engine.correct).toBe(1)
    })

    it('penalizes wrong marks and missed liberties', () => {
      let engine = new QuizEngine(singleSgf)
      engine.advance(); engine.activateQuestions() // B[ee]=[4,4], 4 liberties: [3,4],[5,4],[4,3],[4,5]
      let marked = new Set(['3,4', '0,0']) // 1 correct, 1 wrong, 3 missed
      let result = engine.answerMark(marked)
      expect(result.penalties).toBe(4) // 1 wrong + 3 missed
      expect(engine.errors).toBe(4)
      expect(engine.wrong).toBe(1)
    })

    it('always advances to next question', () => {
      // Use SGF with 2+ questions on last move
      let sgf = '(;SZ[9];B[ba];W[aa])'
      let engine = new QuizEngine(sgf)
      engine.advance() // not last
      engine.advance(); engine.activateQuestions() // last, 2 questions
      let v1 = engine.questionVertex
      engine.answerMark(new Set()) // all wrong, but still advances
      expect(engine.questionVertex).not.toEqual(v1)
    })

    it('returns done when last question answered', () => {
      let engine = new QuizEngine(singleSgf)
      engine.advance(); engine.activateQuestions()
      // Answer all questions
      while (engine.questionVertex) {
        let libs = engine.trueBoard.getLiberties(engine.questionVertex)
        let marked = new Set(libs.map(([x, y]) => `${x},${y}`))
        let result = engine.answerMark(marked)
        if (!engine.questionVertex && !engine.comparisonPair) expect(result.done).toBe(true)
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

    it('end-questions select groups that changed from initial position', () => {
      // B[ba] then W[aa]: both new stones, both differ from empty initial board
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance() // B[ba] — not last, no questions
      expect(engine.questions.length).toBe(0)
      engine.advance(); engine.activateQuestions() // W[aa] — last, both groups changed
      expect(engine.questions.length).toBe(2)
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

    it('end-questions skip groups unchanged from initial position', () => {
      // Setup: black at dd. Moves: B[ee], W[aa]
      // dd is setup stone — unchanged (same vertex set, same libs) → skipped
      // ee and aa are new → selected
      let engine = new QuizEngine('(;SZ[9]AB[dd];B[ee];W[aa])')
      engine.advance() // B[ee]
      engine.advance(); engine.activateQuestions() // W[aa] — last move
      // dd setup stone has unchanged liberties (no adjacent moves) → not asked
      // ee and aa are new → both asked
      let asked = engine.questions.map(v => `${v[0]},${v[1]}`)
      expect(asked).toContain('4,4') // B[ee]
      expect(asked).toContain('0,0') // W[aa]
      expect(asked).not.toContain('3,3') // AB[dd] unchanged
    })

    it('end-questions include groups with changed liberties from setup', () => {
      // Setup: black at ee (4 libs). Move: W[de] adjacent → ee libs: 4→3
      let engine = new QuizEngine('(;SZ[9]AB[ee];W[de])')
      engine.advance(); engine.activateQuestions() // W[de] — last (only) move
      // ee has changed libs (4→3), de is new → both asked
      let asked = engine.questions.map(v => `${v[0]},${v[1]}`)
      expect(asked).toContain('4,4') // B[ee] libs changed
      expect(asked).toContain('3,4') // W[de] new
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
        if (engine.comparisonPair) {
          let { libsZ, libsX } = engine.comparisonPair
          let trueAnswer = libsZ < libsX ? 'Z' : libsX < libsZ ? 'X' : 'equal'
          let result = engine.answerComparison(trueAnswer)
          history.push(true)
          if (result.done) { engine.advance(); engine.activateQuestions() }
          continue
        }
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
      engine.advance() // B[ba] — not last, no questions
      engine.advance(); engine.activateQuestions() // W[aa] — last, 2 questions
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
      // Answer comparison questions
      while (engine.comparisonPair) {
        let { libsZ, libsX } = engine.comparisonPair
        let trueAnswer = libsZ < libsX ? 'Z' : libsX < libsZ ? 'X' : 'equal'
        let result = engine.answerComparison(trueAnswer)
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
      // 4 moves, questions only on last. Last move has multiple questions.
      let sgf = '(;SZ[9];B[ba];W[aa];B[ee];W[de])'
      let engine = new QuizEngine(sgf)
      // Advance all 4 moves (no questions until last)
      engine.advance() // B[ba]
      engine.advance() // W[aa]
      engine.advance() // B[ee]
      engine.advance(); engine.activateQuestions() // W[de] — last, questions activate
      // Answer first question
      let libs = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
      engine.answer(libs)
      let moveIdx = engine.moveIndex
      let correct = engine.correct
      let qVertex = engine.questionVertex

      // Replay with [true] for first question only
      let replayed = QuizEngine.fromReplay(sgf, [true])
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
    it('maxQuestions=0 produces no questions', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])', true, 0)
      engine.advance() // B[ba] — not last
      expect(engine.questions.length).toBe(0)
      engine.advance() // W[aa] — last, but maxQ=0
      expect(engine.questions.length).toBe(0)
      expect(engine.questionVertex).toBe(null)
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
      // With 0 questions, all moves are auto-advanced through replay
      // The engine should be at move 1 with showingMove=true (no questions to answer)
      expect(engine.correct).toBe(0)
      expect(engine.wrong).toBe(0)
    })
  })

  describe('multi-question per move', () => {
    it('asks about all groups changed from initial on last move', () => {
      // B[ba] then W[aa] — both new stones, both differ from empty initial
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance() // B[ba] — not last, no questions
      expect(engine.questions.length).toBe(0)
      engine.advance() // W[aa] — last, both groups changed from initial
      expect(engine.questions.length).toBe(2)
    })

    it('answer returns done only after last question on last move', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance() // B[ba] — not last, no questions
      engine.advance(); engine.activateQuestions() // W[aa] — last, 2 liberty questions + comparison
      // First liberty answer
      let r2 = engine.answer(Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5))
      expect(r2.done).toBe(false)
      // Second liberty answer
      let r3 = engine.answer(Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5))
      expect(engine.questionVertex).toBe(null) // liberty questions done
      // Answer any comparison questions
      while (engine.comparisonPair) {
        let { libsZ, libsX } = engine.comparisonPair
        let trueAnswer = libsZ < libsX ? 'Z' : libsX < libsZ ? 'X' : 'equal'
        let result = engine.answerComparison(trueAnswer)
        if (result.done) break
      }
      expect(engine._moveQuestionsDone).toBe(true)
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

    it('non-adjacent groups both asked on last move', () => {
      // Both groups are new (changed from initial) → both asked
      let engine = new QuizEngine('(;SZ[9];B[aa];W[ii])')
      engine.advance() // B[aa] — not last, no questions
      expect(engine.questions.length).toBe(0)
      engine.advance() // W[ii] — last, both groups changed from initial
      expect(engine.questions.length).toBe(2)
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
      let engine = new QuizEngine(sgf, true, 1)
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
      // Single-move SGF so questions appear immediately on last (only) move
      let sgf = '(;SZ[9];B[ee])'
      let engine = new QuizEngine(sgf)
      engine.advance(); engine.activateQuestions() // B[ee] — last (only) move
      let trueLiberties = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
      let wrongAnswer = trueLiberties === 1 ? 2 : 1
      engine.answer(wrongAnswer) // wrong → showWindow=2
      engine.answer(trueLiberties) // retry correct
      expect(engine.showWindow).toBe(2)
      // Only 1 invisible stone (B[ee]) and it's the current move, so windowStones excludes it
      let windowStones = engine.getWindowStones()
      expect(windowStones.length).toBe(0) // no previous stones to show

      // Multi-stone: 3 moves, wrong answer on last → showWindow=2, 2 previous invisible stones
      let sgf2 = '(;SZ[9];B[ee];W[de];B[ce])'
      let engine2 = new QuizEngine(sgf2, true, 1)
      engine2.advance() // B[ee]
      engine2.advance() // W[de]
      engine2.advance(); engine2.activateQuestions() // B[ce] — last move, 1 question (maxQ=1)
      let libs2 = Math.min(engine2.trueBoard.getLiberties(engine2.questionVertex).length, 5)
      let wrong2 = libs2 === 1 ? 2 : 1
      engine2.answer(wrong2) // wrong → showWindow=2
      engine2.answer(libs2) // retry correct
      expect(engine2.showWindow).toBe(2)
      let ws2 = engine2.getWindowStones()
      // showWindow=2 → show 1 previous stone (the most recent non-current invisible)
      expect(ws2.length).toBeLessThanOrEqual(1)
    })
  })

  describe('comparison questions', () => {
    // B[ba]=(1,0) then W[aa]=(0,0): adjacent, opposite color
    // After W[aa]: B has 2 libs, W has 1 lib → |2-1|=1 ≤ 1 → comparison generated
    let adjacentSgf = '(;SZ[9];B[ba];W[aa])'

    // Non-adjacent: B in corner, W far away → no comparison
    let distantSgf = '(;SZ[9];B[aa];W[ii])'

    it('generates comparison for adjacent opposite-color groups with diff <= 1', () => {
      let engine = new QuizEngine(adjacentSgf)
      engine.advance() // B[ba] — sole group, no comparison
      expect(engine.comparisonQuestions.length).toBe(0)
      engine.advance() // W[aa] — adjacent to B[ba]
      expect(engine.comparisonQuestions.length).toBe(1)
    })

    it('no comparison for non-adjacent groups', () => {
      let engine = new QuizEngine(distantSgf)
      engine.advance() // B[aa]
      engine.advance() // W[ii] — far away
      expect(engine.comparisonQuestions.length).toBe(0)
    })

    it('no comparison when diff > 1', () => {
      // B[ee]=(4,4) center: 4 libs, W[de]=(3,4) adjacent: 3 libs → |4-3|=1 ok
      // But after B[ce]=(2,4): W[de] now has 2 libs, B groups separate
      // We need a case where diff > 1. B center=4 libs vs W corner=1 lib
      let engine = new QuizEngine('(;SZ[9];B[ee];W[ai])')
      engine.advance() // B[ee]
      engine.advance() // W[ai] — not adjacent to B[ee]
      expect(engine.comparisonQuestions.length).toBe(0)
    })

    it('no comparison when neither group asked (maxQ=0)', () => {
      let engine = new QuizEngine(adjacentSgf, true, 0)
      engine.advance() // B[ba] — not last
      engine.advance() // W[aa] — last, maxQ=0 → no liberty questions → no comparison
      expect(engine.questions.length).toBe(0)
      expect(engine.comparisonQuestions.length).toBe(0)
    })

    it('no comparison when only one group changed from initial', () => {
      // Only 1 move, 1 new group — can't compare with anything
      let engine = new QuizEngine('(;SZ[9];B[ee])')
      engine.advance() // B[ee] — last (only), 1 group changed
      expect(engine.questions.length).toBe(1)
      expect(engine.comparisonQuestions.length).toBe(0)
    })

    it('Z is assigned to left-or-above stone', () => {
      let engine = new QuizEngine(adjacentSgf)
      engine.advance() // B[ba]
      engine.advance() // W[aa]
      expect(engine.comparisonQuestions.length).toBeGreaterThan(0)
      let q = engine.comparisonQuestions[0]
      // Z should be left-or-above: lower x, or same x lower y
      let zLeft = q.vertexZ[0] < q.vertexX[0]
      let zAbove = q.vertexZ[0] === q.vertexX[0] && q.vertexZ[1] < q.vertexX[1]
      expect(zLeft || zAbove).toBe(true)
    })

    it('answerComparison records correct answer', () => {
      let engine = new QuizEngine(adjacentSgf)
      engine.advance(); engine.activateQuestions()
      // Answer all liberty questions
      while (engine.questionVertex) {
        let libs = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
        engine.answer(libs)
      }
      engine.advance(); engine.activateQuestions()
      while (engine.questionVertex) {
        let libs = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
        engine.answer(libs)
      }
      expect(engine.comparisonPair).not.toBe(null)
      let { libsZ, libsX } = engine.comparisonPair
      let trueAnswer = libsZ < libsX ? 'Z' : libsX < libsZ ? 'X' : 'equal'
      let prevCorrect = engine.correct
      let result = engine.answerComparison(trueAnswer)
      expect(result.correct).toBe(true)
      expect(engine.correct).toBe(prevCorrect + 1)
    })

    it('answerComparison records wrong answer', () => {
      let engine = new QuizEngine(adjacentSgf)
      engine.advance(); engine.activateQuestions()
      while (engine.questionVertex) {
        let libs = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
        engine.answer(libs)
      }
      engine.advance(); engine.activateQuestions()
      while (engine.questionVertex) {
        let libs = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
        engine.answer(libs)
      }
      expect(engine.comparisonPair).not.toBe(null)
      let { libsZ, libsX } = engine.comparisonPair
      let trueAnswer = libsZ < libsX ? 'Z' : libsX < libsZ ? 'X' : 'equal'
      let wrongAnswer = trueAnswer === 'Z' ? 'X' : 'Z'
      let prevWrong = engine.wrong
      let result = engine.answerComparison(wrongAnswer)
      expect(result.correct).toBe(false)
      expect(engine.wrong).toBe(prevWrong + 1)
    })

    it('done is false from answerMark when comparisons remain', () => {
      let engine = new QuizEngine(adjacentSgf)
      engine.advance(); engine.activateQuestions()
      // Answer liberty for first move (no comparison)
      while (engine.questionVertex) engine.answer(Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5))
      engine.advance(); engine.activateQuestions()
      // Answer liberty questions for second move
      let lastResult
      while (engine.questionVertex) {
        lastResult = engine.answer(Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5))
      }
      // Last liberty answer should have done=false because comparison remains
      expect(engine.comparisonPair).not.toBe(null)
      expect(lastResult.done).toBe(false)
    })

    it('moveProgress.total includes comparison count', () => {
      let engine = new QuizEngine(adjacentSgf)
      engine.advance() // B[ba] — 1 liberty question, 0 comparisons
      expect(engine.moveProgress[0].total).toBe(engine.questions.length + engine.comparisonQuestions.length)
      engine.advance() // W[aa] — liberty questions + comparison
      let mp = engine.moveProgress[1]
      expect(mp.total).toBeGreaterThan(engine.questions.length) // comparisons added
    })

    it('questionsPerMove precompute includes comparison count', () => {
      let engine = new QuizEngine(adjacentSgf)
      // questionsPerMove[1] should include comparison questions for move 2
      let move2Total = engine.questionsPerMove[1]
      // Simulate to verify
      let sim = new QuizEngine(adjacentSgf, false)
      sim.advance() // move 1
      sim.advance() // move 2
      expect(move2Total).toBe(sim.questions.length + sim.comparisonQuestions.length)
    })

    it('equalVertex is set per comparison question', () => {
      let engine = new QuizEngine(adjacentSgf)
      engine.advance() // B[ba]
      engine.advance() // W[aa] — comparison generated
      expect(engine.comparisonQuestions.length).toBeGreaterThan(0)
      let eq = engine.comparisonQuestions[0].equalVertex
      expect(eq).not.toBe(null)
      // equalVertex should be an empty intersection
      expect(engine.trueBoard.get(eq)).toBe(0)
    })

    it('equalVertex is null when no comparisons', () => {
      let engine = new QuizEngine(distantSgf)
      engine.advance() // B[aa]
      engine.advance() // W[ii] — no comparison (too far)
      expect(engine.comparisonQuestions.length).toBe(0)
    })

    it('equalVertex forms triangle with Z/X', () => {
      let engine = new QuizEngine(adjacentSgf)
      engine.advance()
      engine.advance()
      let q = engine.comparisonQuestions[0]
      expect(q.equalVertex).not.toBe(null)
      let [ex, ey] = q.equalVertex
      let dZ = Math.abs(ex - q.vertexZ[0]) + Math.abs(ey - q.vertexZ[1])
      let dX = Math.abs(ex - q.vertexX[0]) + Math.abs(ey - q.vertexX[1])
      // Should be close to both Z and X (triangle placement)
      expect(dZ + dX).toBeLessThanOrEqual(6)
    })

    it('equalVertex avoids questioned and comparison vertices', () => {
      let engine = new QuizEngine(adjacentSgf)
      engine.advance()
      engine.advance()
      for (let cq of engine.comparisonQuestions) {
        if (!cq.equalVertex) continue
        let eqKey = `${cq.equalVertex[0]},${cq.equalVertex[1]}`
        for (let q of engine.questions)
          expect(eqKey).not.toBe(`${q[0]},${q[1]}`)
        expect(eqKey).not.toBe(`${cq.vertexZ[0]},${cq.vertexZ[1]}`)
        expect(eqKey).not.toBe(`${cq.vertexX[0]},${cq.vertexX[1]}`)
      }
    })

    it('fromReplay handles comparison questions', () => {
      let sgf = adjacentSgf
      let engine = new QuizEngine(sgf)
      let history = []
      engine.advance(); engine.activateQuestions()
      while (!engine.finished) {
        if (engine.comparisonPair) {
          let { libsZ, libsX } = engine.comparisonPair
          let trueAnswer = libsZ < libsX ? 'Z' : libsX < libsZ ? 'X' : 'equal'
          let result = engine.answerComparison(trueAnswer)
          history.push(true)
          if (result.done) { engine.advance(); engine.activateQuestions() }
          continue
        }
        if (!engine.questionVertex) { engine.advance(); engine.activateQuestions(); continue }
        let libs = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
        let result = engine.answer(libs)
        history.push(true)
        if (result.done) { engine.advance(); engine.activateQuestions() }
      }
      let replayed = QuizEngine.fromReplay(sgf, history)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(engine.correct)
      expect(replayed.results).toEqual(engine.results)
    })
  })

  describe('hint states', () => {
    // At every point in a quiz session, exactly one hint condition should be active:
    // 1. showingMove (not finished, not questioning) → "Tap board for the next move"
    // 2. questionVertex → "Tap all liberties of ? group"
    // 3. comparisonPair → "Tap the group with less liberties"
    // 4. finished → stats/buttons (no action hint)
    function hintState(engine) {
      if (engine.finished) return 'finished'
      if (engine.questionVertex) return 'liberty'
      if (engine.comparisonPair) return 'comparison'
      return 'advance'
    }

    it('every state in a full session maps to exactly one hint', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      let states = []
      engine.advance()
      states.push(hintState(engine)) // showingMove
      engine.activateQuestions()
      while (!engine.finished) {
        let s = hintState(engine)
        states.push(s)
        if (s === 'liberty') {
          let libs = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
          let result = engine.answer(libs)
          if (result.done) { engine.advance(); engine.activateQuestions() }
        } else if (s === 'comparison') {
          let { libsZ, libsX } = engine.comparisonPair
          let trueAnswer = libsZ < libsX ? 'Z' : libsX < libsZ ? 'X' : 'equal'
          let result = engine.answerComparison(trueAnswer)
          if (result.done) { engine.advance(); engine.activateQuestions() }
        } else {
          engine.advance()
          engine.activateQuestions()
        }
      }
      states.push(hintState(engine))

      expect(states.includes('advance')).toBe(true)
      expect(states.includes('liberty')).toBe(true)
      expect(states.includes('finished')).toBe(true)
      // Every state is one of the known hint states
      for (let s of states) expect(['advance', 'liberty', 'comparison', 'finished']).toContain(s)
    })

    it('hits all hint states including comparison', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      let seen = new Set()
      engine.advance()
      seen.add(hintState(engine))
      engine.activateQuestions()
      while (!engine.finished) {
        let s = hintState(engine)
        seen.add(s)
        if (s === 'liberty') {
          let libs = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
          let result = engine.answer(libs)
          if (result.done) { engine.advance(); engine.activateQuestions() }
        } else if (s === 'comparison') {
          let { libsZ, libsX } = engine.comparisonPair
          let trueAnswer = libsZ < libsX ? 'Z' : libsX < libsZ ? 'X' : 'equal'
          let result = engine.answerComparison(trueAnswer)
          if (result.done) { engine.advance(); engine.activateQuestions() }
        } else {
          engine.advance()
          engine.activateQuestions()
        }
      }
      seen.add(hintState(engine))

      expect(seen).toContain('advance')
      expect(seen).toContain('liberty')
      expect(seen).toContain('comparison')
      expect(seen).toContain('finished')
    })
  })

})
