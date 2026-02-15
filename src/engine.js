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
  constructor(sgfString, mode = 'liberty', _precompute = true, maxQuestions = 3) {
    this.mode = mode
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

    // Snapshot initial position for liberty-end comparison
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

    // Precompute question counts per move (ideal play, no wrong answers)
    if (_precompute) {
      let sim = new QuizEngine(sgfString, mode, false, maxQuestions)
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
    this.questionVertex = this.questions[this.questionIndex] || null
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
    let done = this.questionIndex >= this.questions.length
    return { penalties, done }
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
      let done = this.questionIndex >= this.questions.length
      return { correct: true, trueLiberties, done }
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
    let done = this.questionIndex >= this.questions.length
    return { correct: true, trueLiberties, done }
  }

  _advanceQuestion() {
    this.questionIndex++
    this.questionVertex = this.questionIndex < this.questions.length
      ? this.questions[this.questionIndex]
      : null
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
    // liberty-end: no questions until last move
    if (this.mode === 'liberty-end' && this.moveIndex < this.totalMoves) {
      this.questions = []
      this.questionIndex = 0
      this.questionVertex = null
      this.moveProgress[this.moveProgress.length - 1] = { total: 0, results: [] }
      this.questionsPerMove[this.questionsPerMove.length - 1] = 0
      this.questionsAsked[this.questionsAsked.length - 1] = []
      return
    }
    if (this.mode === 'liberty-end') {
      this.questions = this._selectEndQuestions()
    } else {
      this.peekGroupScores = this.getGroupScores()
      let pool = this.peekGroupScores.filter(g => g.libsChanged)
      let currentMoveKey = vertexKey(move.vertex)
      for (let g of pool) {
        g._justPlayed = g.vertices.some(v => vertexKey(v) === currentMoveKey) ? 0 : 1
        g._rand = this.random()
      }
      pool.sort((a, b) => a.liberties - b.liberties || a._justPlayed - b._justPlayed || a._rand - b._rand)
      this.questions = pool.map(g =>
        g.vertices[Math.floor(this.random() * g.vertices.length)]
      )
      let filtered = this.questions.filter(q => this.trueBoard.getLiberties(q).length < 6)
      if (filtered.length > 0) this.questions = filtered
      this.questions = this.questions.slice(0, this.maxQuestions)
    }
    this.questionIndex = 0
    this.questionVertex = this.showingMove ? null : (this.questions[0] || null)
    this.moveProgress[this.moveProgress.length - 1] = { total: this.questions.length, results: [] }
    this.questionsPerMove[this.questionsPerMove.length - 1] = this.questions.length
    this.questionsAsked[this.questionsAsked.length - 1] = this.questions.map(v => ({ vertex: v }))
  }

  _advanceLiberty(move) {
    // liberty-end: skip questions until the last move
    if (this.mode === 'liberty-end' && this.moveIndex < this.totalMoves) {
      this.questions = []
      this.questionIndex = 0
      this.questionVertex = null
      this.moveProgress.push({ total: 0, results: [] })
      this.questionsAsked.push([])
      return
    }

    // liberty-end on last move: use dedicated end-game selection
    if (this.mode === 'liberty-end') {
      this.questions = this._selectEndQuestions()
      this.questionIndex = 0
      this.questionVertex = null
      this.moveProgress.push({ total: this.questions.length, results: [] })
      this.questionsAsked.push(this.questions.map(v => ({ vertex: v })))
      return
    }

    // Build question queue: all groups with changed liberties
    // Sort: liberties asc, just-played first, random tiebreak
    this.peekGroupScores = this.getGroupScores()
    let pool = this.peekGroupScores.filter(g => g.libsChanged)
    let currentMoveKey = vertexKey(move.vertex)
    for (let g of pool) {
      g._justPlayed = g.vertices.some(v => vertexKey(v) === currentMoveKey) ? 0 : 1
      g._rand = this.random()
    }
    pool.sort((a, b) => a.liberties - b.liberties || a._justPlayed - b._justPlayed || a._rand - b._rand)

    this.questions = pool.map(g =>
      g.vertices[Math.floor(this.random() * g.vertices.length)]
    )

    // Skip groups with 6+ liberties (answer is always "5+"), keep at least one
    let filtered = this.questions.filter(q => this.trueBoard.getLiberties(q).length < 6)
    if (filtered.length > 0) this.questions = filtered

    this.questions = this.questions.slice(0, this.maxQuestions)
    this.questionIndex = 0
    this.questionVertex = null
    this.moveProgress.push({ total: this.questions.length, results: [] })
    this.questionsAsked.push(this.questions.map(v => ({ vertex: v })))
  }

  // Select questions for liberty-end mode:
  // All groups whose vertex-set or liberty-set differs from initial position.
  // No filtering. Randomized. Sliced to maxQuestions.
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


  _pruneCaptured() {
    for (let [key] of this.staleness) {
      let [x, y] = key.split(',').map(Number)
      if (this.trueBoard.get([x, y]) === 0) {
        this.staleness.delete(key)
        this.invisibleStones.delete(key)
      }
    }
  }

  static fromReplay(sgfString, history, mode = 'liberty', maxQuestions = 3) {
    let engine = new QuizEngine(sgfString, mode, true, maxQuestions)
    engine.advance()
    engine.activateQuestions()
    for (let wasCorrectFirst of history) {
      if (engine.finished) break
      // Skip moves with no liberty questions
      while (!engine.questionVertex && !engine.finished) {
        engine.advance()
        engine.activateQuestions()
      }
      if (!engine.questionVertex) break
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
    }
    // If we landed on a fresh move with no answers yet, show the move first
    if (!engine.finished && !engine.retrying) {
      let mp = engine.moveProgress[engine.moveProgress.length - 1]
      if (mp && mp.results.length === 0) {
        engine.showingMove = true
        engine.questionVertex = null
        engine.questionIndex = 0
      }
    }
    return engine
  }

}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}
