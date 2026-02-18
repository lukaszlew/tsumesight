import Board from '@sabaki/go-board'
import { parseSgf, computeRange } from './sgf-utils.js'

function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++)
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  return hash
}

function vertexKey([x, y]) {
  return `${x},${y}`
}

function libertySetKey(libs) {
  return libs.map(vertexKey).sort().join(';')
}


export class QuizEngine {
  constructor(sgfString, _precompute = true, maxQuestions = 3) {
    this.maxQuestions = maxQuestions
    this.random = mulberry32(hashString(sgfString))
    let parsed = parseSgf(sgfString)
    this.boardSize = parsed.boardSize
    this.gameName = parsed.gameName
    this.moves = parsed.moves.filter(m => m.vertex != null) // skip passes
    this.totalMoves = this.moves.length

    // Set up true board with initial position
    this.trueBoard = Board.fromDimensions(this.boardSize)
    for (let [x, y] of parsed.setupBlack) this.trueBoard.set([x, y], 1)
    for (let [x, y] of parsed.setupWhite) this.trueBoard.set([x, y], -1)

    // Snapshot initial position for end-of-sequence comparison
    this.initialBoard = Board.fromDimensions(this.boardSize)
    for (let [x, y] of parsed.setupBlack) this.initialBoard.set([x, y], 1)
    for (let [x, y] of parsed.setupWhite) this.initialBoard.set([x, y], -1)

    // Base sign map: what the user sees (mutable copy of initial position)
    this.baseSignMap = this.trueBoard.signMap.map(row => [...row])

    // Tracking
    this.invisibleStones = new Map() // vertexKey → {sign, vertex, moveNumber}
    this.staleness = new Map() // vertexKey → number (turns since last questioned, cap 4)
    for (let y = 0; y < this.boardSize; y++)
      for (let x = 0; x < this.boardSize; x++)
        if (this.trueBoard.get([x, y]) !== 0)
          this.staleness.set(vertexKey([x, y]), 0)
    this.prevLibs = new Map() // vertexKey → liberty count before current move
    this.peekGroupScores = [] // snapshot of scores used for question selection
    this.moveIndex = 0
    this.currentMove = null
    this.questions = []
    this.questionIndex = 0
    this.questionVertex = null
    this.correct = 0
    this.wrong = 0
    this.errors = 0 // total wrong answers (for 5s penalty)
    this.results = []
    this.moveProgress = [] // [{total, correct}] per played move
    this.boardRange = computeRange(sgfString) // [minX, minY, maxX, maxY] or null
    this.retrying = false
    this.blockedAnswers = new Set() // wrong answers blocked for current question
    this.showingMove = false
    this.showWindow = 1 // how many recent stones visible during show phase (grows on wrong answers)
    this.finished = false
    this.questionsAsked = [] // per move: [{vertex}...]
    this.comparisonQuestions = [] // [{vertexZ, vertexX, libsZ, libsX}]
    this.comparisonIndex = 0
    this.comparisonPair = null // current comparison pair or null
    this.equalVertex = null // empty vertex for "= Equal" tap during comparison

    // Precompute question counts per move (ideal play, no wrong answers)
    if (_precompute) {
      let sim = new QuizEngine(sgfString, false, maxQuestions)
      while (!sim.finished) sim.advance()
      this.questionsPerMove = sim.moveProgress.map(m => m.total)
    } else {
      this.questionsPerMove = []
    }
  }

  advance() {
    if (this.moveIndex >= this.totalMoves) {
      this.finished = true
      this.currentMove = null
      this.questions = []
      this.questionIndex = 0
      this.questionVertex = null
      // Keep comparisonQuestions for review, clear active state only
      this.comparisonIndex = 0
      this.comparisonPair = null
      return null
    }

    let move = this.moves[this.moveIndex]
    this.moveIndex++
    this.currentMove = move

    // Age all tracked stones (before adding the new one)
    for (let [key, val] of this.staleness) {
      this.staleness.set(key, Math.min(val + 1, 4))
    }

    // Snapshot liberty sets before the move (to detect changed libs)
    this.prevLibs = new Map()
    for (let [key] of this.staleness) {
      let [x, y] = key.split(',').map(Number)
      if (this.trueBoard.get([x, y]) !== 0)
        this.prevLibs.set(key, libertySetKey(this.trueBoard.getLiberties([x, y])))
    }

    // Play on true board (may fail on illegal positions in problem SGFs)
    try {
      this.trueBoard = this.trueBoard.makeMove(move.sign, move.vertex)
    } catch {
      // Skip illegal move — treat as end of playable sequence
      this.moveIndex = this.totalMoves
      this.finished = true
      this.currentMove = null
      this.questions = []
      this.questionIndex = 0
      this.questionVertex = null
      // Keep comparisonQuestions for review, clear active state only
      this.comparisonIndex = 0
      this.comparisonPair = null
      return null
    }

    // Track as invisible (not shown on base display)
    let key = vertexKey(move.vertex)
    this.invisibleStones.set(key, { sign: move.sign, vertex: move.vertex, moveNumber: this.moveIndex })
    this.staleness.set(key, 0)

    // Remove captured stones from tracking
    this._pruneCaptured()

    this._advanceLiberty(move)

    this.showingMove = true
    return {
      moveIndex: this.moveIndex,
      totalMoves: this.totalMoves,
      currentMove: this.currentMove,
      questionVertex: this.questionVertex,
    }
  }

  activateQuestions() {
    this.showingMove = false
    this.blockedAnswers.clear()
    if (this.questionIndex < this.questions.length) {
      this.questionVertex = this.questions[this.questionIndex]
    } else {
      this.questionVertex = null
      this._activateComparison()
    }
  }

  answer(value) {
    return this._answerLiberty(value)
  }

  // Mark mode: user marks liberty positions on the board, then submits.
  // markedSet: Set of "x,y" strings
  // Returns { penalties, done }
  answerMark(markedSet) {
    let v = this.questionVertex
    assert(v != null, 'No question to answer')

    let trueLibs = this.trueBoard.getLiberties(v)
    let trueSet = new Set(trueLibs.map(([x, y]) => `${x},${y}`))

    // Wrong marks (marked but not a liberty) + missed liberties (liberty but not marked)
    // Store marks for review
    let moveIdx = this.moveProgress.length - 1
    this.questionsAsked[moveIdx][this.questionIndex].marks = [...markedSet]
    this.questionsAsked[moveIdx][this.questionIndex].trueLibs = [...trueSet]

    let wrongMarks = 0
    for (let k of markedSet) if (!trueSet.has(k)) wrongMarks++
    let missed = 0
    for (let k of trueSet) if (!markedSet.has(k)) missed++
    let penalties = wrongMarks + missed

    this.errors += penalties
    this.results.push(penalties === 0)
    let mp = this.moveProgress[this.moveProgress.length - 1]
    if (penalties === 0) {
      this.correct++
      mp.results.push('correct')
    } else {
      this.wrong++
      mp.results.push('failed')
    }

    // Always advance to next question
    this._advanceQuestion()
    return { penalties, done: this._moveQuestionsDone }
  }

  _answerLiberty(liberties) {
    let v = this.questionVertex
    assert(v != null, 'No question to answer')

    let trueLiberties = Math.min(this.trueBoard.getLiberties(v).length, 5)
    let isCorrect = liberties === trueLiberties

    // Retry after wrong — don't record, block wrong choice, advance on correct
    if (this.retrying) {
      if (!isCorrect) {
        this.errors++
        this.blockedAnswers.add(liberties)
        return { correct: false, trueLiberties, done: false }
      }
      this.retrying = false
      this.blockedAnswers.clear()
      this._advanceQuestion()
      return { correct: true, trueLiberties, done: this._moveQuestionsDone }
    }

    this.results.push(isCorrect)
    let mp = this.moveProgress[this.moveProgress.length - 1]

    if (!isCorrect) {
      this.wrong++
      this.errors++
      this.showWindow++
      mp.results.push('failed')
      this.blockedAnswers.add(liberties)
      this.retrying = true
      return { correct: false, trueLiberties, done: false }
    }

    this.correct++
    mp.results.push('correct')
    this._advanceQuestion()
    return { correct: true, trueLiberties, done: this._moveQuestionsDone }
  }

  get _moveQuestionsDone() {
    return this.questionVertex === null && this.comparisonPair === null
  }

  _advanceQuestion() {
    this.questionIndex++
    if (this.questionIndex < this.questions.length) {
      this.questionVertex = this.questions[this.questionIndex]
    } else {
      this.questionVertex = null
      this._activateComparison()
    }
  }

  _activateComparison() {
    this.comparisonPair = this.comparisonIndex < this.comparisonQuestions.length
      ? this.comparisonQuestions[this.comparisonIndex]
      : null
  }

  _advanceComparison() {
    this.comparisonIndex++
    this._activateComparison()
  }

  // choice: 'Z' | 'X' | 'equal'
  answerComparison(choice) {
    assert(this.comparisonPair, 'No comparison to answer')
    let { libsZ, libsX } = this.comparisonPair
    let trueAnswer = libsZ < libsX ? 'Z' : libsX < libsZ ? 'X' : 'equal'
    this.comparisonQuestions[this.comparisonIndex].userChoice = choice
    this.comparisonQuestions[this.comparisonIndex].trueAnswer = trueAnswer
    let isCorrect = choice === trueAnswer

    this.results.push(isCorrect)
    let mp = this.moveProgress[this.moveProgress.length - 1]
    if (isCorrect) { this.correct++; mp.results.push('correct') }
    else { this.wrong++; this.errors++; mp.results.push('failed') }

    this._advanceComparison()
    return { correct: isCorrect, trueAnswer, done: this.comparisonPair === null }
  }

  materialize() {
    // Present the true board as-is (captures removed, all stones shown)
    this.baseSignMap = this.trueBoard.signMap.map(row => [...row])
    this.invisibleStones.clear()
    this.staleness.clear()
  }

  getDisplaySignMap() {
    return this.baseSignMap.map(row => [...row])
  }

  // Returns the most recent invisible stones (excluding current move) that should
  // be visible during the show phase, based on showWindow size.
  getWindowStones() {
    if (this.showWindow <= 1) return []
    let extras = [...this.invisibleStones.values()]
      .filter(s => !this.currentMove || vertexKey(s.vertex) !== vertexKey(this.currentMove.vertex))
      .sort((a, b) => b.moveNumber - a.moveNumber)
      .slice(0, this.showWindow - 1)
    return extras
  }

  // Returns all groups on the board with their properties
  // Each group: { vertices: [[x,y]...], liberties, libsChanged }
  getGroupScores() {
    let visited = new Set()
    let groups = []
    let currentMoveKey = this.currentMove ? vertexKey(this.currentMove.vertex) : null

    for (let y = 0; y < this.boardSize; y++) {
      for (let x = 0; x < this.boardSize; x++) {
        let vertex = [x, y]
        let k = vertexKey(vertex)
        if (visited.has(k)) continue
        if (this.trueBoard.get(vertex) === 0) continue

        let chain = this.trueBoard.getChain(vertex)
        for (let v of chain) visited.add(vertexKey(v))

        let libs = this.trueBoard.getLiberties(vertex).length
        let containsCurrentMove = chain.some(v => vertexKey(v) === currentMoveKey)

        // Did this group's liberty set change after the current move?
        // Current move's group always counts as "changed"
        let currentLibsKey = libertySetKey(this.trueBoard.getLiberties(vertex))
        let libsChanged = containsCurrentMove
        if (!libsChanged) {
          for (let v of chain) {
            let prev = this.prevLibs.get(vertexKey(v))
            if (prev !== undefined && prev !== currentLibsKey) {
              libsChanged = true
              break
            }
          }
        }

        groups.push({ vertices: chain, liberties: libs, libsChanged })
      }
    }
    return groups
  }

  recomputeQuestions() {
    let move = this.currentMove
    if (!move) return
    // No questions until last move
    if (this.moveIndex < this.totalMoves) {
      this.questions = []
      this.questionIndex = 0
      this.questionVertex = null
      this.moveProgress[this.moveProgress.length - 1] = { total: 0, results: [] }
      this.questionsPerMove[this.questionsPerMove.length - 1] = 0
      this.questionsAsked[this.questionsAsked.length - 1] = []
      return
    }
    this.questions = this.maxQuestions === 0 ? [] : this._selectEndQuestions()
    this.questionIndex = 0
    this.questionVertex = this.showingMove ? null : (this.questions[0] || null)
    this.questionsAsked[this.questionsAsked.length - 1] = this.questions.map(v => ({ vertex: v }))
    this._generateComparisonQuestions()
    this.moveProgress[this.moveProgress.length - 1] = { total: this.questions.length + this.comparisonQuestions.length, results: [] }
    this.questionsPerMove[this.questionsPerMove.length - 1] = this.questions.length + this.comparisonQuestions.length
  }

  _advanceLiberty(move) {
    // Skip questions until the last move
    if (this.moveIndex < this.totalMoves) {
      this.questions = []
      this.questionIndex = 0
      this.questionVertex = null
      this.comparisonQuestions = []
      this.comparisonIndex = 0
      this.comparisonPair = null
      this.moveProgress.push({ total: 0, results: [] })
      this.questionsAsked.push([])
      return
    }

    // Last move: select questions from groups that changed since initial position
    this.questions = this.maxQuestions === 0 ? [] : this._selectEndQuestions()
    this.questionIndex = 0
    this.questionVertex = null
    this.questionsAsked.push(this.questions.map(v => ({ vertex: v })))
    this._generateComparisonQuestions()
    this.moveProgress.push({ total: this.questions.length + this.comparisonQuestions.length, results: [] })
  }

  // Select end-of-sequence questions:
  // All groups whose vertex-set or liberty-set differs from initial position.
  // No filtering. Randomized.
  _selectEndQuestions() {
    // Map initial groups: vertexSetKey → libertySetKey
    let initialGroups = new Map()
    let visited = new Set()
    for (let y = 0; y < this.boardSize; y++)
      for (let x = 0; x < this.boardSize; x++) {
        let v = [x, y]
        let k = vertexKey(v)
        if (visited.has(k) || this.initialBoard.get(v) === 0) continue
        let chain = this.initialBoard.getChain(v)
        for (let cv of chain) visited.add(vertexKey(cv))
        let vSetKey = chain.map(vertexKey).sort().join(';')
        let libKey = libertySetKey(this.initialBoard.getLiberties(v))
        initialGroups.set(vSetKey, libKey)
      }

    // Collect final groups that differ from initial (or are new)
    let questions = []
    visited = new Set()
    for (let y = 0; y < this.boardSize; y++)
      for (let x = 0; x < this.boardSize; x++) {
        let v = [x, y]
        let k = vertexKey(v)
        if (visited.has(k) || this.trueBoard.get(v) === 0) continue
        let chain = this.trueBoard.getChain(v)
        for (let cv of chain) visited.add(vertexKey(cv))
        let vSetKey = chain.map(vertexKey).sort().join(';')
        let libKey = libertySetKey(this.trueBoard.getLiberties(v))
        if (initialGroups.get(vSetKey) === libKey) continue
        if (this.trueBoard.getLiberties(v).length > 5) continue
        questions.push(chain[Math.floor(this.random() * chain.length)])
      }

    // Fisher-Yates shuffle
    for (let i = questions.length - 1; i > 0; i--) {
      let j = Math.floor(this.random() * (i + 1))
      ;[questions[i], questions[j]] = [questions[j], questions[i]]
    }

    return questions
  }


  _generateComparisonQuestions() {
    this.comparisonQuestions = []
    this.comparisonIndex = 0
    this.comparisonPair = null
    if (this.questions.length === 0) return

    let questionedKeys = new Set(this.questions.map(v => vertexKey(v)))

    // Enumerate all groups with sign, chainKeys, wasAsked
    let visited = new Set()
    let groups = []
    for (let y = 0; y < this.boardSize; y++) {
      for (let x = 0; x < this.boardSize; x++) {
        let v = [x, y]
        let k = vertexKey(v)
        if (visited.has(k) || this.trueBoard.get(v) === 0) continue
        let chain = this.trueBoard.getChain(v)
        let chainKeys = new Set()
        for (let cv of chain) { let ck = vertexKey(cv); visited.add(ck); chainKeys.add(ck) }
        let sign = this.trueBoard.get(v)
        let libs = this.trueBoard.getLiberties(v).length
        let wasAsked = chain.some(cv => questionedKeys.has(vertexKey(cv)))
        groups.push({ sign, chain, libs, chainKeys, wasAsked })
      }
    }

    // Find adjacent opposite-color pairs with |diff| <= 1, both asked
    let seenPairs = new Set()
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        let gi = groups[i], gj = groups[j]
        if (gi.sign === gj.sign) continue
        if (Math.abs(gi.libs - gj.libs) > 1) continue
        if (!gi.wasAsked || !gj.wasAsked) continue
        let borderPair = this._findBorderPair(gi, gj)
        if (!borderPair) continue
        let pairKey = i < j ? `${i},${j}` : `${j},${i}`
        if (seenPairs.has(pairKey)) continue
        seenPairs.add(pairKey)

        let [stoneA, stoneB] = borderPair
        // Z = left or above
        let aIsZ = stoneA[0] < stoneB[0] || (stoneA[0] === stoneB[0] && stoneA[1] < stoneB[1])
        this.comparisonQuestions.push({
          vertexZ: aIsZ ? stoneA : stoneB,
          vertexX: aIsZ ? stoneB : stoneA,
          libsZ: aIsZ ? gi.libs : gj.libs,
          libsX: aIsZ ? gj.libs : gi.libs,
        })
      }
    }
    this._findEqualVertex()
  }

  _findEqualVertex() {
    this.equalVertex = null
    if (this.comparisonQuestions.length === 0) return

    // Avoid: all liberty question vertices + all comparison Z/X vertices
    let avoid = new Set(this.questions.map(vertexKey))
    let zxVertices = []
    for (let q of this.comparisonQuestions) {
      avoid.add(vertexKey(q.vertexZ))
      avoid.add(vertexKey(q.vertexX))
      zxVertices.push(q.vertexZ, q.vertexX)
    }

    function dist(v1, v2) { return Math.abs(v1[0] - v2[0]) + Math.abs(v1[1] - v2[1]) }

    // Search all intersections: empty, not occupied, not in avoid set
    // Score = sum of distances to Z/X markers + distance to board center (all weighted equally)
    let [x0, y0, x1, y1] = this.boardRange || [0, 0, this.boardSize - 1, this.boardSize - 1]
    let center = [(x0 + x1) / 2, (y0 + y1) / 2]
    let best = null, bestScore = Infinity
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        if (this.trueBoard.get([x, y]) !== 0) continue
        if (avoid.has(vertexKey([x, y]))) continue
        let score = dist([x, y], center)
        for (let zx of zxVertices) score += dist([x, y], zx)
        if (score < bestScore) { bestScore = score; best = [x, y] }
      }

    this.equalVertex = best
  }

  _findBorderPair(groupA, groupB) {
    let candidates = []
    for (let stone of groupA.chain) {
      for (let neighbor of this.trueBoard.getNeighbors(stone)) {
        if (groupB.chainKeys.has(vertexKey(neighbor)))
          candidates.push([stone, neighbor])
      }
    }
    if (candidates.length === 0) return null

    // Prefer pairs with the current move stone
    let moveKey = this.currentMove ? vertexKey(this.currentMove.vertex) : null
    if (moveKey) {
      let withMove = candidates.filter(([a, b]) =>
        vertexKey(a) === moveKey || vertexKey(b) === moveKey)
      if (withMove.length > 0) return withMove[0]
    }

    // Then prefer invisible (recently placed) stones
    let withInvisible = candidates.filter(([a, b]) =>
      this.invisibleStones.has(vertexKey(a)) || this.invisibleStones.has(vertexKey(b)))
    if (withInvisible.length > 0) return withInvisible[0]

    return candidates[0]
  }

  _pruneCaptured() {
    for (let [key] of this.staleness) {
      let [x, y] = key.split(',').map(Number)
      if (this.trueBoard.get([x, y]) === 0) {
        this.staleness.delete(key)
        this.invisibleStones.delete(key)
      }
    }
  }

  static fromReplay(sgfString, history, maxQuestions = 3) {
    let engine = new QuizEngine(sgfString, true, maxQuestions)
    engine.advance()
    engine.activateQuestions()
    for (let wasCorrectFirst of history) {
      if (engine.finished) break
      // Skip moves with no questions (liberty or comparison)
      while (!engine.questionVertex && !engine.comparisonPair && !engine.finished) {
        engine.advance()
        engine.activateQuestions()
      }
      if (engine.questionVertex) {
        let trueLiberties = Math.min(engine.trueBoard.getLiberties(engine.questionVertex).length, 5)
        if (wasCorrectFirst) {
          let result = engine.answer(trueLiberties)
          if (result.done) { engine.advance(); engine.activateQuestions() }
        } else {
          let wrongAnswer = trueLiberties === 1 ? 2 : 1
          engine.answer(wrongAnswer)
          let result = engine.answer(trueLiberties)
          if (result.done) { engine.advance(); engine.activateQuestions() }
        }
      } else if (engine.comparisonPair) {
        let { libsZ, libsX } = engine.comparisonPair
        let trueAnswer = libsZ < libsX ? 'Z' : libsX < libsZ ? 'X' : 'equal'
        if (wasCorrectFirst) {
          let result = engine.answerComparison(trueAnswer)
          if (result.done) { engine.advance(); engine.activateQuestions() }
        } else {
          let wrongAnswer = trueAnswer === 'Z' ? 'X' : 'Z'
          let result = engine.answerComparison(wrongAnswer)
          if (result.done) { engine.advance(); engine.activateQuestions() }
        }
      } else break
    }
    // If we landed on a fresh move with no answers yet, show the move first
    if (!engine.finished && !engine.retrying) {
      let mp = engine.moveProgress[engine.moveProgress.length - 1]
      if (mp && mp.results.length === 0) {
        engine.showingMove = true
        engine.questionVertex = null
        engine.comparisonPair = null
        engine.questionIndex = 0
      }
    }
    return engine
  }

}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}
