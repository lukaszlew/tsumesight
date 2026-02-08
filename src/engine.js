import Board from '@sabaki/go-board'
import { parseSgf } from './sgf-utils.js'

function vertexKey([x, y]) {
  return `${x},${y}`
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
    this.moveIndex = 0
    this.currentMove = null
    this.questionVertex = null
    this.correct = 0
    this.wrong = 0
    this.results = []
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

    // Play on true board
    this.trueBoard = this.trueBoard.makeMove(move.sign, move.vertex)

    // Track as invisible (not shown on base display)
    this.invisibleStones.set(vertexKey(move.vertex), {
      sign: move.sign,
      vertex: move.vertex,
    })

    // Remove captured invisible stones (they died on trueBoard)
    this._pruneDeadInvisible()

    // Pick question: random invisible stone still alive on trueBoard
    this.questionVertex = this._pickQuestion()

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

    let trueLiberties = Math.min(this.trueBoard.getLiberties(v).length, 6)
    let isCorrect = liberties === trueLiberties

    if (isCorrect) {
      this.correct++
    } else {
      this.wrong++
      this.materialize()
    }
    this.results.push(isCorrect)

    return { correct: isCorrect, trueLiberties }
  }

  materialize() {
    // Copy all invisible stones to baseSignMap so they become visible
    for (let [, { vertex }] of this.invisibleStones) {
      let [x, y] = vertex
      let sign = this.trueBoard.get(vertex)
      // Stone might have been captured — only materialize if alive
      if (sign !== 0) {
        this.baseSignMap[y][x] = sign
      }
    }
    this.invisibleStones.clear()
  }

  // Build the display signMap for rendering
  getDisplaySignMap() {
    let display = this.baseSignMap.map(row => [...row])
    // Overlay current move stone so it's visible
    if (this.currentMove && this.currentMove.vertex) {
      let [x, y] = this.currentMove.vertex
      display[y][x] = this.currentMove.sign
    }
    return display
  }

  _pruneDeadInvisible() {
    for (let [key, { vertex }] of this.invisibleStones) {
      if (this.trueBoard.get(vertex) === 0) {
        // Stone was captured on true board — but stays visible on base display
        // (spec: captured stones not removed from display)
        this.invisibleStones.delete(key)
      }
    }
  }

  _pickQuestion() {
    let alive = []
    for (let [, entry] of this.invisibleStones) {
      if (this.trueBoard.get(entry.vertex) !== 0) {
        alive.push(entry.vertex)
      }
    }
    if (alive.length === 0) return null
    return alive[Math.floor(Math.random() * alive.length)]
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}
