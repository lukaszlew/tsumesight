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
    this.boardRange = computeRange(sgfString) // [minX, minY, maxX, maxY] or null
    this.showingMove = false
    this.finished = false
    this.boardHistory = [] // trueBoard after each move (for intermediate lib tracking)
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

    this.boardHistory.push(this.trueBoard)

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

  // Check marks without submitting. Returns per changed group:
  // { status: 'correct'|'wrong'|'missed', userVertex?, userVal? }
  checkLibertyExercise(marks) {
    assert(this.libertyExerciseActive, 'No liberty exercise active')
    let changedGroups = this.libertyExercise.groups.filter(g => g.changed)
    return changedGroups.map(g => {
      let target = Math.min(g.libCount, config.maxLibertyLabel)
      let userVertex = null, userVal = null
      // Check all marks in the group — any correct mark counts
      for (let k of g.chainKeys) {
        if (!marks.has(k)) continue
        let v = marks.get(k)
        if (v === target) { userVertex = k; userVal = v; break }
        if (!userVertex) { userVertex = k; userVal = v }
      }
      if (userVertex === null) return { status: 'missed' }
      if (userVal === target) return { status: 'correct', userVertex, userVal }
      return { status: 'wrong', userVertex, userVal }
    })
  }

  getDisplaySignMap() {
    return this.baseSignMap.map(row => [...row])
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

  _advanceLiberty(move) {
    // Only set up a liberty exercise on the final move.
    if (this.moveIndex < this.totalMoves) {
      this.libertyExercise = null
      this.libertyExerciseActive = false
      return
    }
    if (this.maxQuestions === 0) {
      this.libertyExercise = null
      return
    }
    this._setupLibertyExercise()
  }

  // Enumerate all groups on final board.
  // Each group: { vertex (representative), chainKeys, libCount, changed }.
  // changed = liberty count changed at any point during the variation.
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
        // Changed if: new group, or liberty count differs from initial or any intermediate state
        let changed = initialLibCount === undefined || initialLibCount !== libCount
        if (!changed) {
          // Same chain and libs as initial — check intermediate boards
          for (let i = 0; i < this.boardHistory.length - 1; i++) {
            let board = this.boardHistory[i]
            let ref = chain[0]
            if (board.get(ref) === 0) { changed = true; break }
            let midChain = board.getChain(ref)
            let midKey = midChain.map(vertexKey).sort().join(';')
            if (midKey !== vSetKey || board.getLiberties(ref).length !== libCount) {
              changed = true; break
            }
          }
        }
        // If the group (or its ancestor before merging) was 5+ throughout, pre-mark it
        if (changed && libCount >= config.maxLibertyLabel) {
          let ref = chain[0]
          let alwaysCapped = (initialLibCount === undefined
            ? this.initialBoard.get(ref) !== 0 && this.initialBoard.getLiberties(ref).length >= config.maxLibertyLabel
            : initialLibCount >= config.maxLibertyLabel)
          if (alwaysCapped) {
            alwaysCapped = this.boardHistory.slice(0, -1).every(board => {
              if (board.get(ref) === 0) return false
              return board.getLiberties(ref).length >= config.maxLibertyLabel
            })
          }
          if (alwaysCapped) changed = false
        }
        let color = this.trueBoard.get(chain[0])
        let initialStones = chain.filter(cv => this.initialBoard.get(cv) === color)
        // 6+ libs at end and part of the group existed on initial board → pre-mark as 5+
        if (changed && libCount > config.maxLibertyLabel && initialStones.length > 0)
          changed = false
        // Prefer pre-existing stone for representative vertex (label / ? placement)
        let pool = initialStones.length > 0 ? initialStones : chain
        let vertex = pool[Math.floor(this.random() * pool.length)]
        groups.push({ vertex, chainKeys, libCount, changed })
      }

    this.libertyExercise = { groups }
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}
