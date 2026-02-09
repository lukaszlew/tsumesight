import Board from '@sabaki/go-board'
import { parseSgf, computeRange } from './sgf-utils.js'

function vertexKey([x, y]) {
  return `${x},${y}`
}

function libertySetKey(libs) {
  return libs.map(vertexKey).sort().join(';')
}

function libertyBonus(libCount) {
  if (libCount <= 3) return 2
  if (libCount === 4) return 1
  return 0
}

export class QuizEngine {
  constructor(sgfString, _precompute = true) {
    let parsed = parseSgf(sgfString)
    this.boardSize = parsed.boardSize
    this.moves = parsed.moves.filter(m => m.vertex != null) // skip passes
    this.totalMoves = this.moves.length

    // Set up true board with initial position
    this.trueBoard = Board.fromDimensions(this.boardSize)
    for (let [x, y] of parsed.setupBlack) this.trueBoard.set([x, y], 1)
    for (let [x, y] of parsed.setupWhite) this.trueBoard.set([x, y], -1)

    // Base sign map: what the user sees (mutable copy of initial position)
    this.baseSignMap = this.trueBoard.signMap.map(row => [...row])

    // Tracking
    this.invisibleStones = new Map() // vertexKey → {sign, vertex}
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
    this.results = []
    this.moveProgress = [] // [{total, correct}] per played move
    this.boardRange = computeRange(sgfString) // [minX, minY, maxX, maxY] or null
    this.retrying = false
    this.finished = false

    // Precompute question counts per move (ideal play, no wrong answers)
    if (_precompute) {
      let sim = new QuizEngine(sgfString, false)
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
    this.invisibleStones.set(key, { sign: move.sign, vertex: move.vertex })
    this.staleness.set(key, 0)

    // Remove captured stones from tracking
    this._pruneCaptured()

    // Build question queue: all groups with changed liberties
    this.peekGroupScores = this.getGroupScores()
    let pool = this.peekGroupScores.filter(g => g.libsChanged)
    pool.sort((a, b) => b.score - a.score)

    this.questions = pool.map(g =>
      g.vertices[Math.floor(Math.random() * g.vertices.length)]
    )

    // Always ask about just-played stone first
    let moveChainKeys = new Set(this.trueBoard.getChain(move.vertex).map(vertexKey))
    this.questions = this.questions.filter(q => !moveChainKeys.has(vertexKey(q)))
    this.questions.unshift(move.vertex)

    this.questionIndex = 0
    this.questionVertex = this.questions[0] || null
    this.moveProgress.push({ total: this.questions.length, results: [] })

    // Reset staleness for all questioned groups
    for (let qv of this.questions) {
      let chain = this.trueBoard.getChain(qv)
      for (let v of chain) {
        let k = vertexKey(v)
        if (this.staleness.has(k)) this.staleness.set(k, -1)
      }
    }

    return {
      moveIndex: this.moveIndex,
      totalMoves: this.totalMoves,
      currentMove: this.currentMove,
      questionVertex: this.questionVertex,
    }
  }

  answer(liberties) {
    let v = this.questionVertex
    assert(v != null, 'No question to answer')

    let trueLiberties = Math.min(this.trueBoard.getLiberties(v).length, 5)
    let isCorrect = liberties === trueLiberties

    // Retry after wrong — don't record, restore hidden state on correct
    if (this.retrying) {
      if (!isCorrect) return { correct: false, trueLiberties, done: false }
      this.retrying = false
      this.baseSignMap = this._savedBaseSignMap
      this.invisibleStones = this._savedInvisibleStones
      this.staleness = this._savedStaleness
      this._savedBaseSignMap = null
      this._savedInvisibleStones = null
      this._savedStaleness = null
      // Continue with remaining questions
      this.questionIndex++
      this.questionVertex = this.questionIndex < this.questions.length
        ? this.questions[this.questionIndex]
        : null
      let done = this.questionIndex >= this.questions.length
      return { correct: true, trueLiberties, done }
    }

    this.results.push(isCorrect)
    let mp = this.moveProgress[this.moveProgress.length - 1]

    if (!isCorrect) {
      this.wrong++
      mp.results.push('failed')
      // Save state before materialize so we can restore after retry
      this._savedBaseSignMap = this.baseSignMap.map(row => [...row])
      this._savedInvisibleStones = new Map(this.invisibleStones)
      this._savedStaleness = new Map(this.staleness)
      this.materialize()
      this.retrying = true
      return { correct: false, trueLiberties, done: false }
    }

    this.correct++
    mp.results.push('correct')
    this.questionIndex++
    this.questionVertex = this.questionIndex < this.questions.length
      ? this.questions[this.questionIndex]
      : null
    let done = this.questionIndex >= this.questions.length
    return { correct: true, trueLiberties, done }
  }

  materialize() {
    for (let [, { vertex }] of this.invisibleStones) {
      let [x, y] = vertex
      let sign = this.trueBoard.get(vertex)
      if (sign !== 0) {
        this.baseSignMap[y][x] = sign
      }
    }
    this.invisibleStones.clear()
    this.staleness.clear()
  }

  getDisplaySignMap() {
    return this.baseSignMap.map(row => [...row])
  }

  // Returns all groups on the board with their scores
  // Each group: { vertices: [[x,y]...], score, liberties, libsChanged }
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
        let maxStaleness = 0
        for (let v of chain) {
          visited.add(vertexKey(v))
          maxStaleness = Math.max(maxStaleness, this.staleness.get(vertexKey(v)) || 0)
        }

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

        // Just-played single stone: no bonuses (you just saw it placed)
        let isSingleCurrent = chain.length === 1 && containsCurrentMove
        let score = isSingleCurrent
          ? maxStaleness
          : maxStaleness + libertyBonus(libs)
        groups.push({ vertices: chain, score, liberties: libs, libsChanged })
      }
    }
    return groups
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

}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}
