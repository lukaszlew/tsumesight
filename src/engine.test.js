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
      let state = engine.advance()
      // Only one invisible stone, so question must be it
      expect(state.questionVertex).toEqual([4, 4])
    })

    it('returns null when all moves are played', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance()
      engine.answer(1, 4) // correct or not, doesn't matter for advance
      engine.advance()
      engine.answer(-1, 4)
      engine.advance()
      engine.answer(1, 4)
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
    it('returns correct when both color and liberties match', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance() // B[ee] on 9x9, center stone, 4 liberties
      let result = engine.answer(1, 4) // black, 4+ liberties
      expect(result.correct).toBe(true)
      expect(result.trueColor).toBe(1)
      expect(result.trueLiberties).toBe(4)
      expect(engine.correct).toBe(1)
      expect(engine.wrong).toBe(0)
    })

    it('returns wrong when color is incorrect', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance()
      let result = engine.answer(-1, 4) // wrong color
      expect(result.correct).toBe(false)
      expect(engine.wrong).toBe(1)
    })

    it('returns wrong when liberties are incorrect', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance()
      let result = engine.answer(1, 2) // wrong liberties
      expect(result.correct).toBe(false)
    })

    it('materializes invisible stones on wrong answer', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance() // B[ee]
      engine.advance() // W[ce]
      expect(engine.invisibleStones.size).toBe(2)
      engine.answer(-1, 1) // wrong
      expect(engine.invisibleStones.size).toBe(0)
      // Stones now visible on base
      expect(engine.baseSignMap[4][4]).toBe(1) // B at ee
      expect(engine.baseSignMap[4][2]).toBe(-1) // W at ce
    })

    it('does not materialize on correct answer', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance() // B[ee]
      // question is [4,4], true color=1, true liberties=4
      engine.answer(1, 4)
      expect(engine.invisibleStones.size).toBe(1) // still invisible
      expect(engine.baseSignMap[4][4]).toBe(0) // still not on base
    })

    it('tracks results array', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance()
      engine.answer(1, 4) // correct
      engine.advance()
      engine.answer(1, 1) // wrong (color wrong)
      expect(engine.results).toEqual([true, false])
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
    it('shows base position plus current move', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance() // B[ee]
      let display = engine.getDisplaySignMap()
      // Current move should be visible
      expect(display[4][4]).toBe(1)
      // Base should still be clean
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
      // ee=[4,4], center of 9x9, 4 neighbors all empty
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
      // ea=[4,0], top edge, 3 liberties
      let libs = engine.trueBoard.getLiberties([4, 0])
      expect(libs.length).toBe(3)
    })

    it('caps at 4 in answer evaluation', () => {
      let engine = new QuizEngine('(;SZ[9];B[ee])')
      engine.advance()
      // ee has 4 liberties, answer(1, 4) should be correct
      let result = engine.answer(1, 4)
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
})
