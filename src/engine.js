import Board from '@sabaki/go-board'
import { parseSgf, computeRange } from './sgf-utils.js'
import config from './config.js'

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
    this.prevLibs = new Map() // vertexKey → liberty set key before current move
    this.moveIndex = 0
    this.currentMove = null
    this.libertyExercise = null // { groups: [{ vertex, chainKeys, libCount, changed }...] }
    this.libertyExerciseActive = false
    this.correct = 0
    this.wrong = 0
    this.errors = 0 // total wrong answers (for 5s penalty)
    this.results = []
    this.moveProgress = [] // [{total, results}] per played move
    this.boardRange = computeRange(sgfString) // [minX, minY, maxX, maxY] or null
    this.showingMove = false
    this.showWindow = 1 // how many recent stones visible during show phase
    this.finished = false
    this.questionsAsked = [] // per move: [{vertex, libCount}...]

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
      // Keep libertyExercise for review display
      this.libertyExerciseActive = false
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

    // Play on true board (captures processed for correct liberty answers)
    try {
      this.trueBoard = this.trueBoard.makeMove(move.sign, move.vertex)
    } catch {
      // Skip illegal move — treat as end of playable sequence
      this.moveIndex = this.totalMoves
      this.finished = true
      this.currentMove = null
      this.libertyExerciseActive = false
      return null
    }

    // Track as invisible (not shown on base display)
    let key = vertexKey(move.vertex)
    this.invisibleStones.set(key, { sign: move.sign, vertex: move.vertex, moveNumber: this.moveIndex })
    this.staleness.set(key, 0)

    this._advanceLiberty(move)

    this.showingMove = true
    return {
      moveIndex: this.moveIndex,
      totalMoves: this.totalMoves,
      currentMove: this.currentMove,
    }
  }

  activateQuestions() {
    this.showingMove = false
    if (this.libertyExercise && this.libertyExercise.groups.some(g => g.changed)) {
      this.libertyExerciseActive = true
    }
  }

  get _moveQuestionsDone() {
    return !this.libertyExerciseActive
  }

  // Check marks without submitting. Returns per changed group:
  // { status: 'correct'|'wrong'|'missed', userVertex?, userVal? }
  checkLibertyExercise(marks) {
    assert(this.libertyExerciseActive, 'No liberty exercise active')
    let changedGroups = this.libertyExercise.groups.filter(g => g.changed)
    return changedGroups.map(g => {
      let target = Math.min(g.libCount, config.maxLibertyLabel)
      let userVertex = null, userVal = null
      for (let k of g.chainKeys) {
        if (marks.has(k)) { userVertex = k; userVal = marks.get(k); break }
      }
      if (userVertex === null) return { status: 'missed' }
      if (userVal === target) return { status: 'correct', userVertex, userVal }
      return { status: 'wrong', userVertex, userVal }
    })
  }

  // Submit the liberty exercise: user's label per stone.
  // marks: Map<vertexKey, number> — the number (1-5) the user assigned to each stone
  // Returns { correctCount, wrongCount, total }
  submitLibertyExercise(marks) {
    assert(this.libertyExerciseActive, 'No liberty exercise active')

    let checked = this.checkLibertyExercise(marks)
    let changedGroups = this.libertyExercise.groups.filter(g => g.changed)
    let correctCount = 0
    let wrongCount = 0
    let moveIdx = this.moveProgress.length - 1

    for (let i = 0; i < changedGroups.length; i++) {
      let markedCorrectly = checked[i].status === 'correct'

      this.results.push(markedCorrectly)
      this.questionsAsked[moveIdx][i].markedCorrectly = markedCorrectly
      if (markedCorrectly) {
        correctCount++
        this.correct++
        this.moveProgress[moveIdx].results.push('correct')
      } else {
        wrongCount++
        this.wrong++
        this.errors++
        this.moveProgress[moveIdx].results.push('failed')
      }
    }

    // Store marks for review
    this.libertyExercise.userMarks = marks

    this.libertyExerciseActive = false
    return { correctCount, wrongCount, total: changedGroups.length }
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
      this.libertyExercise = null
      this.libertyExerciseActive = false
      this.moveProgress[this.moveProgress.length - 1] = { total: 0, results: [] }
      this.questionsPerMove[this.questionsPerMove.length - 1] = 0
      this.questionsAsked[this.questionsAsked.length - 1] = []
      return
    }
    if (this.maxQuestions === 0) {
      this.libertyExercise = null
      this.libertyExerciseActive = false
      this.moveProgress[this.moveProgress.length - 1] = { total: 0, results: [] }
      this.questionsPerMove[this.questionsPerMove.length - 1] = 0
      this.questionsAsked[this.questionsAsked.length - 1] = []
      return
    }
    this._setupLibertyExercise()
    let changedGroups = this.libertyExercise.groups.filter(g => g.changed)
    this.questionsAsked[this.questionsAsked.length - 1] = changedGroups.map(g => ({ vertex: g.vertex, libCount: g.libCount }))
    this.moveProgress[this.moveProgress.length - 1] = { total: changedGroups.length, results: [] }
    this.questionsPerMove[this.questionsPerMove.length - 1] = changedGroups.length
    if (!this.showingMove) {
      this.libertyExerciseActive = this.libertyExercise.groups.some(g => g.changed)
    }
  }

  _advanceLiberty(move) {
    // Skip questions until the last move
    if (this.moveIndex < this.totalMoves) {
      this.libertyExercise = null
      this.libertyExerciseActive = false
      this.moveProgress.push({ total: 0, results: [] })
      this.questionsAsked.push([])
      return
    }

    // Last move: setup liberty exercise
    if (this.maxQuestions === 0) {
      this.libertyExercise = null
      this.moveProgress.push({ total: 0, results: [] })
      this.questionsAsked.push([])
      return
    }

    this._setupLibertyExercise()
    let changedGroups = this.libertyExercise.groups.filter(g => g.changed)
    this.questionsAsked.push(changedGroups.map(g => ({ vertex: g.vertex, libCount: g.libCount })))
    this.moveProgress.push({ total: changedGroups.length, results: [] })
  }

  // Enumerate all groups on final board.
  // Each group: { vertex (representative), chainKeys, libCount, changed }.
  // changed = liberty count differs from initial position or group is new.
  _setupLibertyExercise() {
    // Map initial groups: vertexSetKey → libCount
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
        let libCount = this.initialBoard.getLiberties(v).length
        initialGroups.set(vSetKey, libCount)
      }

    // Enumerate all groups on final board
    let groups = []
    visited = new Set()
    for (let y = 0; y < this.boardSize; y++)
      for (let x = 0; x < this.boardSize; x++) {
        let v = [x, y]
        let k = vertexKey(v)
        if (visited.has(k) || this.trueBoard.get(v) === 0) continue
        let chain = this.trueBoard.getChain(v)
        let chainKeys = new Set()
        for (let cv of chain) { visited.add(vertexKey(cv)); chainKeys.add(vertexKey(cv)) }
        let libCount = this.trueBoard.getLiberties(v).length
        let vSetKey = chain.map(vertexKey).sort().join(';')
        let initialLibCount = initialGroups.get(vSetKey)
        // Changed if: new group (not in initial) or liberty count changed
        let changed = initialLibCount === undefined || initialLibCount !== libCount
        let vertex = chain[Math.floor(this.random() * chain.length)]
        groups.push({ vertex, chainKeys, libCount, changed })
      }

    this.libertyExercise = { groups }
  }


  static fromReplay(sgfString, history, maxQuestions = 3) {
    let engine = new QuizEngine(sgfString, true, maxQuestions)
    // Advance all moves
    while (!engine.finished) {
      engine.advance()
      engine.activateQuestions()
      if (engine.libertyExerciseActive) break
    }

    if (!engine.libertyExerciseActive) {
      // No exercise — return as-is (finished or no changed groups)
      if (!engine.finished) {
        engine.showingMove = true
      }
      return engine
    }

    if (history.length === 0) {
      // No answers yet — show the move first
      engine.showingMove = true
      engine.libertyExerciseActive = false
      return engine
    }

    // Reconstruct marks from boolean history (one bool per changed group)
    let changedGroups = engine.libertyExercise.groups.filter(g => g.changed)
    let marks = new Map()
    for (let i = 0; i < changedGroups.length; i++) {
      let g = changedGroups[i]
      let wasCorrect = i < history.length ? history[i] : false
      if (wasCorrect) {
        marks.set([...g.chainKeys][0], Math.min(g.libCount, config.maxLibertyLabel))
      }
    }

    engine.submitLibertyExercise(marks)
    engine.advance() // finish
    return engine
  }

}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}
