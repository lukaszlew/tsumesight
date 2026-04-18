import { QuizEngine } from './engine.js'
import config from './config.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function vertexKey(v) {
  return `${v[0]},${v[1]}`
}

// Cursor-based quiz session. Owns all quiz-session state; delegates Go
// board/liberty logic to QuizEngine (treated as a library).
//
// State:
//   cursor       0..N       how far through the moves
//   marks        Map        user's liberty-count marks (absolute values; 0 = clear)
//   submitCount  int        number of submits done
//   feedback     array|null per-group statuses from the latest submit
//   events       []         canonical append-only log
//
// Phase is derived; no separate booleans.
export class QuizSession {
  constructor(sgf, { maxSubmits = 2, maxQuestions = 2 } = {}) {
    this.sgf = sgf
    this.maxSubmits = maxSubmits
    this.maxQuestions = maxQuestions
    this.engine = new QuizEngine(sgf, true, maxQuestions)
    this.totalMoves = this.engine.totalMoves
    this.cursor = 0
    this.hasExercise = false
    this.marks = new Map()
    this.submitCount = 0
    this.feedback = null
    this.submitResults = []   // append-only; used by scoring fold
    this.events = []
    this.startTime = null
    this.clockNow = () => performance.now()
  }

  get phase() {
    if (this.cursor < this.totalMoves) return 'showing'
    if (!this.hasExercise) return 'finished'
    if (this.finalized) return 'finished'
    if (this.submitCount === 0) return 'exercise-fresh'
    return 'exercise-feedback'
  }

  get finalized() {
    if (this.submitCount === 0) return false
    if (this.submitCount >= this.maxSubmits) return true
    return this.feedback?.every(f => f.status === 'correct') === true
  }

  get elapsedMs() {
    if (this.startTime == null) return 0
    return Math.round(this.clockNow() - this.startTime)
  }

  applyEvent(event) {
    if (this.startTime == null) this.startTime = this.clockNow()
    let t = event.t ?? Math.round(this.clockNow() - this.startTime)
    let recorded = { ...event, t }

    switch (event.kind) {
      case 'advance':
        this._doAdvance()
        break
      case 'rewind':
        this._doRewind()
        break
      case 'setMark':
        this._doSetMark(event.vertex, event.value)
        break
      case 'submit':
        this._doSubmit()
        break
      default:
        throw new Error(`Unknown event kind: ${event.kind}`)
    }

    this.events.push(recorded)
  }

  _doAdvance() {
    assert(this.cursor < this.totalMoves, `advance at cursor=${this.cursor}/${this.totalMoves}`)
    this.engine.advance()
    this.cursor++
    if (this.cursor === this.totalMoves) {
      this.engine.activateQuestions()
      this.hasExercise = this.engine.libertyExerciseActive
    }
  }

  _doRewind() {
    // Rebuild engine from scratch; preserve session-level state (marks,
    // submitCount, feedback, submitResults, startTime, events).
    this.engine = new QuizEngine(this.sgf, true, this.maxQuestions)
    this.cursor = 0
    this.hasExercise = false
  }

  _doSetMark(vertex, value) {
    assert(this.cursor === this.totalMoves, `setMark at cursor=${this.cursor}`)
    assert(!this.finalized, `setMark after finalized`)
    let key = vertexKey(vertex)
    if (value === 0) this.marks.delete(key)
    else this.marks.set(key, value)
    // Any mark change invalidates the displayed feedback; next submit refreshes it.
    this.feedback = null
  }

  _doSubmit() {
    assert(this.cursor === this.totalMoves, `submit at cursor=${this.cursor}`)
    assert(this.hasExercise, `submit with no exercise`)
    assert(!this.finalized, `submit after finalized`)
    let result = this.engine.checkLibertyExercise(this.marks)
    this.feedback = result
    this.submitResults.push(result)
    this.submitCount++
  }

  // --- Derived views for UI / scoring ---

  get changedGroups() {
    return this.engine.libertyExercise?.groups.filter(g => g.changed) || []
  }

  // Per-group: number of submits on which this group was not correct.
  mistakesByGroup() {
    let n = this.changedGroups.length
    let counts = new Array(n).fill(0)
    for (let r of this.submitResults) {
      for (let i = 0; i < n; i++) {
        if (r[i]?.status !== 'correct') counts[i]++
      }
    }
    return counts
  }

  totalMistakes() {
    return this.mistakesByGroup().reduce((a, b) => a + b, 0)
  }
}

// Pure fold over a session's submit history; returns per-group point values.
// Mirrors the rule in scoring.js: [10, 5, 0] for [0, 1, 2+] mistakes per group.
export function pointsByGroup(mistakesByGroup) {
  return mistakesByGroup.map(m => [10, 5, 0][Math.min(m, 2)])
}
