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
      engine.answer(4)
      engine.advance()
      engine.answer(4)
      engine.advance()
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
      engine.advance() // B[ee] on 9x9, center stone, 4 liberties
      let result = engine.answer(4)
      expect(result.correct).toBe(true)
      expect(result.trueLiberties).toBe(4)
      expect(engine.correct).toBe(1)
      expect(engine.wrong).toBe(0)
    })

    it('returns wrong when liberties are incorrect', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance()
      let result = engine.answer(2)
      expect(result.correct).toBe(false)
      expect(engine.wrong).toBe(1)
    })

    it('materializes invisible stones on wrong answer', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance() // B[ee]
      engine.advance() // W[ce]
      expect(engine.invisibleStones.size).toBe(2)
      engine.answer(1) // wrong
      expect(engine.invisibleStones.size).toBe(0)
      // Stones now visible on base
      expect(engine.baseSignMap[4][4]).toBe(1) // B at ee
      expect(engine.baseSignMap[4][2]).toBe(-1) // W at ce
    })

    it('does not materialize on correct answer', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance() // B[ee]
      // question is [4,4], true liberties=4
      engine.answer(4)
      expect(engine.invisibleStones.size).toBe(1) // still invisible
      expect(engine.baseSignMap[4][4]).toBe(0) // still not on base
    })

    it('tracks results array', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance()
      engine.answer(4) // correct
      engine.advance()
      engine.answer(1) // wrong
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
      engine.advance() // B[ge]
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
      engine.advance()
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
    it('questioned stone gets staleness -1', () => {
      let engine = new QuizEngine(simpleSgf)
      engine.advance() // B[ee] — only stone, questioned, reset to -1
      expect(engine.staleness.get('4,4')).toBe(-1)
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

    it('just-played single stone gets no bonuses', () => {
      let engine = new QuizEngine('(;SZ[9];B[aa])')
      engine.advance()
      let groups = engine.getGroupScores()
      expect(groups.length).toBe(1)
      expect(groups[0].liberties).toBe(2)
      // Single-stone current group: score = staleness only = 0
      expect(groups[0].score).toBe(0)
    })

    it('getGroupScores returns correct liberty bonus for older group', () => {
      // After 2 moves, the older stone gets liberty bonus
      let engine = new QuizEngine('(;SZ[9];B[aa];W[ii])')
      engine.advance() // B[aa] — questioned, staleness → -1
      engine.advance() // W[ii] — B[aa] aged: -1 → 0
      // Use peekGroupScores (snapshot before staleness reset)
      let blackGroup = engine.peekGroupScores.find(g => g.vertices.some(v => v[0] === 0 && v[1] === 0))
      // staleness(0) + libertyBonus(2) = 2
      expect(blackGroup.score).toBe(2)
    })

    it('getGroupScores gives no bonus for 5+ liberties', () => {
      // Two adjacent stones: 6 liberties → bonus 0
      let engine = new QuizEngine('(;SZ[9];B[ee];W[aa];B[fe])')
      engine.advance()
      engine.advance()
      engine.advance()
      let groups = engine.getGroupScores()
      let bigGroup = groups.find(g => g.liberties === 6)
      // score = staleness + 0
      expect(bigGroup.score).toBeLessThanOrEqual(4)
    })

    it('prefers older affected group over just-played single stone', () => {
      // B[ba] edge stone, then W[aa] adjacent — B[ba] libs change
      // Both libsChanged=true, B[ba] has higher score
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance() // B[ba] questioned (only stone)
      engine.advance() // W[aa] — adjacent, B[ba] libs: 3→2
      // B[ba]: staleness 0 + libBonus(2)=2 = 2, libsChanged=true
      // W[aa]: single current = 0, libsChanged=true
      expect(engine.questionVertex).toEqual([1, 0])
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

    it('picks from libsChanged groups over unchanged ones', () => {
      // B[aa] corner (2 libs), W[ii] far corner (2 libs)
      // Then B[bi] adjacent to W[ii] — W[ii] libs change, B[aa] unchanged
      // W[ii] should be picked despite lower staleness
      let engine = new QuizEngine('(;SZ[9];B[aa];W[ii];B[hi])')
      engine.advance() // B[aa]
      engine.advance() // W[ii]
      engine.advance() // B[hi] — adjacent to W[ii], changes its libs
      // B[aa]: libsChanged=false (masked out)
      // W[ii]: libsChanged=true
      // B[hi]: libsChanged=true (single current)
      // Among changed: W[ii] has staleness+bonus, B[hi] has 0
      expect(engine.questionVertex).toEqual([8, 8])
    })

    it('two non-adjacent center stones: unchanged masked out', () => {
      // B[ee] and W[cc] — both 4 libs, not adjacent
      // B[gg] not adjacent to either — both unchanged, falls back to all
      let engine = new QuizEngine('(;SZ[9];B[ee];W[cc];B[gg])')
      engine.advance() // B[ee]
      engine.answer(4)
      engine.advance() // W[cc]
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
      engine.advance() // B[ba]
      let r1 = engine.answer(3) // B[ba] has 3 libs
      expect(r1.done).toBe(true)
      engine.advance() // W[aa] — 2 questions
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
      engine.advance() // W[aa] — 2 questions
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

    it('resets staleness for all questioned groups', () => {
      let engine = new QuizEngine('(;SZ[9];B[ba];W[aa])')
      engine.advance() // B[ba]
      engine.advance() // W[aa] — 2 questions, both get staleness -1
      expect(engine.staleness.get('1,0')).toBe(-1) // B[ba]
      expect(engine.staleness.get('0,0')).toBe(-1) // W[aa]
    })
  })

})
