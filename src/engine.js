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

function libertyBonus(libCount) {
  if (libCount <= 3) return 2
  if (libCount === 4) return 1
  return 0
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
    this.comparisonPair = null // {v1, v2, libs1, libs2} for comparison mode
    this.correct = 0
    this.wrong = 0
    this.results = []
    this.moveProgress = [] // [{total, correct}] per played move
    this.boardRange = computeRange(sgfString) // [minX, minY, maxX, maxY] or null
    this.retrying = false
    this.showingMove = false
    this.finished = false

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
    this.invisibleStones.set(key, { sign: move.sign, vertex: move.vertex })
    this.staleness.set(key, 0)

    // Remove captured stones from tracking
    this._pruneCaptured()

    if (this.mode === 'comparison') {
      this._advanceComparison()
    } else {
      this._advanceLiberty(move)
    }

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
    if (this.mode === 'comparison') {
      this.comparisonPair = this.questions[this.questionIndex] || null
    } else {
      this.questionVertex = this.questions[this.questionIndex] || null
    }
  }

  answer(value) {
    if (this.mode === 'comparison') return this._answerComparison(value)
    return this._answerLiberty(value)
  }

  _answerLiberty(liberties) {
    let v = this.questionVertex
    assert(v != null, 'No question to answer')

    let trueLiberties = Math.min(this.trueBoard.getLiberties(v).length, 5)
    let isCorrect = liberties === trueLiberties

    // Retry after wrong — don't record, restore hidden state on correct
    if (this.retrying) {
      if (!isCorrect) return { correct: false, trueLiberties, done: false }
      this.retrying = false
      this._restoreSaved()
      this._advanceQuestion()
      let done = this.questionIndex >= this.questions.length
      return { correct: true, trueLiberties, done }
    }

    this.results.push(isCorrect)
    let mp = this.moveProgress[this.moveProgress.length - 1]

    if (!isCorrect) {
      this.wrong++
      mp.results.push('failed')
      this._saveAndMaterialize()
      this.retrying = true
      return { correct: false, trueLiberties, done: false }
    }

    this.correct++
    mp.results.push('correct')
    this._advanceQuestion()
    let done = this.questionIndex >= this.questions.length
    return { correct: true, trueLiberties, done }
  }

  _answerComparison(value) {
    let pair = this.comparisonPair
    assert(pair != null, 'No comparison question to answer')

    let trueAnswer = pair.libs1 > pair.libs2 ? 1 : pair.libs1 < pair.libs2 ? 2 : 3
    let isCorrect = value === trueAnswer

    if (this.retrying) {
      if (!isCorrect) return { correct: false, trueAnswer, done: false }
      this.retrying = false
      this._restoreSaved()
      this._advanceQuestion()
      let done = this.questionIndex >= this.questions.length
      return { correct: true, trueAnswer, done }
    }

    this.results.push(isCorrect)
    let mp = this.moveProgress[this.moveProgress.length - 1]

    if (!isCorrect) {
      this.wrong++
      mp.results.push('failed')
      this._saveAndMaterialize()
      this.retrying = true
      return { correct: false, trueAnswer, done: false }
    }

    this.correct++
    mp.results.push('correct')
    this._advanceQuestion()
    let done = this.questionIndex >= this.questions.length
    return { correct: true, trueAnswer, done }
  }

  _advanceQuestion() {
    this.questionIndex++
    if (this.mode === 'comparison') {
      this.comparisonPair = this.questionIndex < this.questions.length
        ? this.questions[this.questionIndex]
        : null
      this.questionVertex = null
    } else {
      this.questionVertex = this.questionIndex < this.questions.length
        ? this.questions[this.questionIndex]
        : null
      this.comparisonPair = null
    }
  }

  _saveAndMaterialize() {
    this._savedBaseSignMap = this.baseSignMap.map(row => [...row])
    this._savedInvisibleStones = new Map(this.invisibleStones)
    this._savedStaleness = new Map(this.staleness)
    this.materialize()
  }

  _restoreSaved() {
    this.baseSignMap = this._savedBaseSignMap
    this.invisibleStones = this._savedInvisibleStones
    this.staleness = this._savedStaleness
    this._savedBaseSignMap = null
    this._savedInvisibleStones = null
    this._savedStaleness = null
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

  recomputeQuestions() {
    let move = this.currentMove
    if (!move) return
    if (this.mode === 'comparison') {
      let pairs = this._findComparisonPairs()
      this.questions = pairs
      this.questionIndex = 0
      this.comparisonPair = this.showingMove ? null : (pairs[0] || null)
      this.questionVertex = null
    } else {
      this.peekGroupScores = this.getGroupScores()
      let pool = this.peekGroupScores.filter(g => g.libsChanged)
      pool.sort((a, b) => b.score - a.score)
      this.questions = pool.map(g =>
        g.vertices[Math.floor(this.random() * g.vertices.length)]
      )
      let moveChainKeys = new Set(this.trueBoard.getChain(move.vertex).map(vertexKey))
      this.questions = this.questions.filter(q => !moveChainKeys.has(vertexKey(q)))
      this.questions.unshift(move.vertex)
      let filtered = this.questions.filter(q => this.trueBoard.getLiberties(q).length < 6)
      if (filtered.length > 0) this.questions = filtered
      this.questions = this.questions.slice(0, this.maxQuestions)
      this.questionIndex = 0
      this.questionVertex = this.showingMove ? null : (this.questions[0] || null)
      this.comparisonPair = null
    }
    this.moveProgress[this.moveProgress.length - 1] = { total: this.questions.length, results: [] }
    this.questionsPerMove[this.questionsPerMove.length - 1] = this.questions.length
  }

  _advanceLiberty(move) {
    // Build question queue: all groups with changed liberties
    this.peekGroupScores = this.getGroupScores()
    let pool = this.peekGroupScores.filter(g => g.libsChanged)
    pool.sort((a, b) => b.score - a.score)

    this.questions = pool.map(g =>
      g.vertices[Math.floor(this.random() * g.vertices.length)]
    )

    // Always ask about just-played stone first
    let moveChainKeys = new Set(this.trueBoard.getChain(move.vertex).map(vertexKey))
    this.questions = this.questions.filter(q => !moveChainKeys.has(vertexKey(q)))
    this.questions.unshift(move.vertex)

    // Skip groups with 6+ liberties (answer is always "5+"), keep at least one
    let filtered = this.questions.filter(q => this.trueBoard.getLiberties(q).length < 6)
    if (filtered.length > 0) this.questions = filtered

    this.questions = this.questions.slice(0, this.maxQuestions)
    this.questionIndex = 0
    this.questionVertex = null
    this.comparisonPair = null
    this.moveProgress.push({ total: this.questions.length, results: [] })

    // Reset staleness for all questioned groups
    for (let qv of this.questions) {
      let chain = this.trueBoard.getChain(qv)
      for (let v of chain) {
        let k = vertexKey(v)
        if (this.staleness.has(k)) this.staleness.set(k, -1)
      }
    }
  }

  _advanceComparison() {
    let pairs = this._findComparisonPairs()
    this.questions = pairs
    this.questionIndex = 0
    this.comparisonPair = null
    this.questionVertex = null
    this.moveProgress.push({ total: pairs.length, results: [] })

    // Reset staleness for all groups involved in questions
    for (let pair of pairs) {
      for (let v of [pair.v1, pair.v2]) {
        let chain = this.trueBoard.getChain(v)
        for (let cv of chain) {
          let k = vertexKey(cv)
          if (this.staleness.has(k)) this.staleness.set(k, -1)
        }
      }
    }
  }

  _findComparisonPairs() {
    let groups = this.getGroupScores()

    // Mark permanent groups (adjacent to empty buffer at edge of boardRange)
    let permanent = new Set()
    let r = this.boardRange
    if (r) {
      let [minX, minY, maxX, maxY] = r
      let s = this.boardSize
      for (let i = 0; i < groups.length; i++) {
        if (groups[i].vertices.some(([x, y]) =>
          (x === minX + 1 && minX > 0) || (x === maxX - 1 && maxX < s - 1) ||
          (y === minY + 1 && minY > 0) || (y === maxY - 1 && maxY < s - 1)
        )) permanent.add(i)
      }
    }

    // Map vertex → group index
    let vertexToGroup = new Map()
    for (let i = 0; i < groups.length; i++)
      for (let v of groups[i].vertices)
        vertexToGroup.set(vertexKey(v), i)

    // Find adjacent pairs of different color, excluding permanent groups
    let seen = new Set()
    let pairs = []
    for (let i = 0; i < groups.length; i++) {
      if (permanent.has(i)) continue
      let ga = groups[i]
      let signA = this.trueBoard.get(ga.vertices[0])
      for (let [x, y] of ga.vertices) {
        for (let [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
          let j = vertexToGroup.get(vertexKey([nx, ny]))
          if (j === undefined || j === i) continue
          if (permanent.has(j)) continue
          let pairKey = i < j ? `${i}-${j}` : `${j}-${i}`
          if (seen.has(pairKey)) continue
          seen.add(pairKey)
          let gb = groups[j]
          // Filter: different colors
          if (this.trueBoard.get(gb.vertices[0]) === signA) continue
          // Filter: |diff| ≤ 2, at least one group's libs changed
          let libsA = ga.liberties, libsB = gb.liberties
          if (Math.abs(libsA - libsB) > 2) continue
          if (!ga.libsChanged && !gb.libsChanged) continue
          let va = ga.vertices[Math.floor(this.random() * ga.vertices.length)]
          let vb = gb.vertices[Math.floor(this.random() * gb.vertices.length)]
          // Label "A" = black, "B" = white
          let blackIsA = signA === 1
          let [v1, v2] = blackIsA ? [va, vb] : [vb, va]
          let [libs1, libs2] = blackIsA ? [libsA, libsB] : [libsB, libsA]
          pairs.push({ v1, v2, libs1, libs2 })
        }
      }
    }
    // Sort: lib_diff asc, opponent-has-more first, just-played first, random tiebreak
    // libs1 = black, libs2 = white; sign = current move's color
    let sign = this.currentMove.sign
    let currentMoveGroup = vertexToGroup.get(vertexKey(this.currentMove.vertex))
    for (let p of pairs) {
      p._diff = Math.abs(p.libs1 - p.libs2)
      // Within same diff: opponent having more libs is more interesting (comes first)
      // sign=1 (B played) → opponent=W → W-has-more first → (libs2-libs1) > 0
      // sign=-1 (W played) → opponent=B → B-has-more first → (libs1-libs2) > 0
      // Equivalently: (libs1-libs2)*(-sign) > 0 means opponent has more
      p._sub = p._diff === 0 ? 0 : ((p.libs1 - p.libs2) * (-sign) > 0 ? 0 : 1)
      p._justPlayed = (vertexToGroup.get(vertexKey(p.v1)) === currentMoveGroup ||
                        vertexToGroup.get(vertexKey(p.v2)) === currentMoveGroup) ? 0 : 1
      p._rand = this.random()
    }
    pairs.sort((a, b) => a._diff - b._diff || a._sub - b._sub || a._justPlayed - b._justPlayed || a._rand - b._rand)
    return pairs.slice(0, this.maxQuestions)
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
      if (engine.mode === 'comparison') {
        // Skip moves with no comparison pairs
        while (!engine.comparisonPair && !engine.finished) {
          engine.advance()
          engine.activateQuestions()
        }
        if (!engine.comparisonPair) break
        let pair = engine.comparisonPair
        let trueAnswer = pair.libs1 > pair.libs2 ? 1 : pair.libs1 < pair.libs2 ? 2 : 3
        if (wasCorrectFirst) {
          let result = engine.answer(trueAnswer)
          if (result.done) { engine.advance(); engine.activateQuestions() }
        } else {
          let wrongAnswer = trueAnswer === 1 ? 2 : 1
          engine.answer(wrongAnswer)
          let result = engine.answer(trueAnswer)
          if (result.done) { engine.advance(); engine.activateQuestions() }
        }
      } else {
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
