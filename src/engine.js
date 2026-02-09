import Board from '@sabaki/go-board'
import { parseSgf } from './sgf-utils.js'

function vertexKey([x, y]) {
  return `${x},${y}`
}

function libertyBonus(libCount) {
  if (libCount <= 3) return 2
  if (libCount === 4) return 1
  return 0
}

export class QuizEngine {
  constructor(sgfString) {
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
    this.prevLibs = new Map() // vertexKey → liberty count before current move
    this.peekGroupScores = [] // snapshot of scores used for question selection
    this.moveIndex = 0
    this.currentMove = null
    this.questionVertex = null
    this.correct = 0
    this.wrong = 0
    this.results = []
    this.lastWrong = null // { vertex, trueLiberties } — shown until next answer
    this.finished = false
  }

  advance() {
    if (this.moveIndex >= this.totalMoves) {
      this.finished = true
      this.currentMove = null
      this.questionVertex = null
      return null
    }

    let move = this.moves[this.moveIndex]
    this.moveIndex++
    this.currentMove = move

    // Age all existing invisible stones (before adding the new one)
    for (let [key, val] of this.staleness) {
      this.staleness.set(key, Math.min(val + 1, 4))
    }

    // Snapshot liberty counts before the move (to detect changed libs)
    this.prevLibs = new Map()
    for (let [key, { vertex }] of this.invisibleStones) {
      if (this.trueBoard.get(vertex) !== 0) {
        this.prevLibs.set(key, this.trueBoard.getLiberties(vertex).length)
      }
    }

    // Play on true board
    this.trueBoard = this.trueBoard.makeMove(move.sign, move.vertex)

    // Track as invisible (not shown on base display)
    let key = vertexKey(move.vertex)
    this.invisibleStones.set(key, { sign: move.sign, vertex: move.vertex })
    this.staleness.set(key, 0)

    // Remove captured invisible stones (they died on trueBoard)
    this._pruneDeadInvisible()

    // Pick question by group scoring (snapshot scores before staleness reset)
    this.peekGroupScores = this.getGroupScores()
    this.questionVertex = this._pickQuestionFrom(this.peekGroupScores)

    // Reset staleness for the chosen group
    if (this.questionVertex) {
      let chain = this.trueBoard.getChain(this.questionVertex)
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
    this.lastWrong = null
    let v = this.questionVertex
    assert(v != null, 'No question to answer')

    let trueLiberties = Math.min(this.trueBoard.getLiberties(v).length, 5)
    let isCorrect = liberties === trueLiberties

    if (isCorrect) {
      this.correct++
    } else {
      this.wrong++
      this.lastWrong = { vertex: v, trueLiberties }
      this.materialize()
    }
    this.results.push(isCorrect)

    return { correct: isCorrect, trueLiberties }
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
    let display = this.baseSignMap.map(row => [...row])
    if (this.currentMove && this.currentMove.vertex) {
      let [x, y] = this.currentMove.vertex
      display[y][x] = this.currentMove.sign
    }
    return display
  }

  // Returns groups of invisible stones with their scores
  // Each group: { vertices: [[x,y]...], score, liberties }
  getGroupScores() {
    let visited = new Set()
    let groups = []
    let currentMoveKey = this.currentMove ? vertexKey(this.currentMove.vertex) : null

    for (let [, { vertex }] of this.invisibleStones) {
      let k = vertexKey(vertex)
      if (visited.has(k)) continue
      if (this.trueBoard.get(vertex) === 0) continue

      let chain = this.trueBoard.getChain(vertex)
      let groupVertices = []
      let maxStaleness = 0
      for (let v of chain) {
        let vk = vertexKey(v)
        visited.add(vk)
        if (this.invisibleStones.has(vk)) {
          groupVertices.push(v)
          maxStaleness = Math.max(maxStaleness, this.staleness.get(vk) || 0)
        }
      }
      if (groupVertices.length === 0) continue

      let libs = this.trueBoard.getLiberties(vertex).length
      let isSingleCurrent = chain.length === 1 && currentMoveKey === vertexKey(chain[0])

      // Did this group's liberty count change after the current move?
      // Current move's group always counts as "changed"
      let libsChanged = isSingleCurrent
      if (!libsChanged) {
        for (let v of groupVertices) {
          let prev = this.prevLibs.get(vertexKey(v))
          if (prev !== undefined && prev !== libs) {
            libsChanged = true
            break
          }
        }
      }

      // Just-played single stone: no bonuses (you just saw it placed)
      let score = isSingleCurrent
        ? maxStaleness
        : maxStaleness + libertyBonus(libs)
      groups.push({ vertices: groupVertices, score, liberties: libs, libsChanged })
    }
    return groups
  }

  _pruneDeadInvisible() {
    for (let [key, { vertex }] of this.invisibleStones) {
      if (this.trueBoard.get(vertex) === 0) {
        this.invisibleStones.delete(key)
        this.staleness.delete(key)
      }
    }
  }

  _pickQuestionFrom(groups) {
    if (groups.length === 0) return null

    // Only consider groups whose libs changed (current move always qualifies)
    let pool = groups.filter(g => g.libsChanged)

    let maxScore = Math.max(...pool.map(g => g.score))
    let best = pool.filter(g => g.score === maxScore)
    let chosen = best[Math.floor(Math.random() * best.length)]
    return chosen.vertices[Math.floor(Math.random() * chosen.vertices.length)]
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}
