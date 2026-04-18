import { QuizEngine } from './engine.js'

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
//   cursor       0..N+1     each advance produces one visible state change
//                           0     = before any advance (empty board)
//                           1..N  = showing move K (engine.showingMove=true)
//                           N+1   = past all moves (in exercise or finished)
//   marks        Map<key, {value, color}>
//                           value: number 1..maxLibertyLabel, or '?' sentinel (missed group)
//                           color: null | 'green' | 'red'
//                           Entries are per-intersection. The eval result from
//                           Done overwrites them in-place (evals replace user
//                           markings — no separate display state).
//   submitCount  int        number of submits done
//   submitResults array     per-submit array of per-group statuses; fold for scoring
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
    this.submitResults = []
    this.events = []
    this.startTime = null
    this.clockNow = () => performance.now()
  }

  get phase() {
    if (this.cursor <= this.totalMoves) return 'showing'
    if (!this.hasExercise) return 'finished'
    if (this.finalized) return 'finished'
    return 'exercise'
  }

  get finalized() {
    if (this.submitCount === 0) return false
    if (this.submitCount >= this.maxSubmits) return true
    let last = this.submitResults.at(-1)
    return last?.every(r => r.status === 'correct') === true
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
        if (this.isLockedVertex(event.vertex)) return  // locked label; no-op
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
    assert(this.cursor <= this.totalMoves, `advance at cursor=${this.cursor}/${this.totalMoves}`)
    if (this.cursor < this.totalMoves) {
      // Play and show the next move.
      this.engine.advance()
      this.cursor++
    } else {
      // cursor === totalMoves: last move is currently shown; activate the
      // exercise (or enter finished if no changed groups). No new stone is
      // played — this advance represents the user moving past the showing
      // state into the next phase.
      this.engine.activateQuestions()
      this.cursor++
      this.hasExercise = this.engine.libertyExerciseActive
    }
  }

  _doRewind() {
    // Rebuild engine from scratch; preserve session-level state (marks,
    // submitCount, submitResults, startTime, events).
    this.engine = new QuizEngine(this.sgf, true, this.maxQuestions)
    this.cursor = 0
    this.hasExercise = false
  }

  _doSetMark(vertex, value) {
    assert(this.cursor === this.totalMoves + 1, `setMark at cursor=${this.cursor}`)
    assert(!this.finalized, `setMark after finalized`)
    let key = vertexKey(vertex)
    if (value === 0) this.marks.delete(key)
    else this.marks.set(key, { value, color: null })
  }

  _doSubmit() {
    assert(this.cursor === this.totalMoves + 1, `submit at cursor=${this.cursor}`)
    assert(this.hasExercise, `submit with no exercise`)
    assert(!this.finalized, `submit after finalized`)

    // Engine wants Map<key, number>. '?' sentinels left over from previous
    // missed-group submits are filtered out (user never intended them).
    let plain = new Map()
    for (let [k, m] of this.marks) {
      if (typeof m.value === 'number') plain.set(k, m.value)
    }
    let result = this.engine.checkLibertyExercise(plain)
    this.submitResults.push(result)
    this.submitCount++

    // Overwrite marks on each changed group's stones with the eval outcome.
    // User's intersection-level marks on the group are replaced by a single
    // entry reflecting the group's result (green/red on user's vertex, or
    // '?' red on the representative vertex for missed).
    let changedGroups = this.changedGroups
    for (let i = 0; i < changedGroups.length; i++) {
      let g = changedGroups[i]
      let r = result[i]
      for (let k of g.chainKeys) this.marks.delete(k)
      if (r.status === 'correct') {
        this.marks.set(r.userVertex, { value: r.userVal, color: 'green' })
      } else if (r.status === 'wrong') {
        this.marks.set(r.userVertex, { value: r.userVal, color: 'red' })
      } else {
        // missed
        this.marks.set(vertexKey(g.vertex), { value: '?', color: 'red' })
      }
    }
  }

  // --- Derived views for UI / scoring ---

  get changedGroups() {
    return this.engine.libertyExercise?.groups.filter(g => g.changed) || []
  }

  // The representative intersection of a pre-marked (unchanged) group shows
  // its fixed liberty count as a label. That specific intersection is not
  // editable by the user. Other stones of the same group stay tappable.
  isLockedVertex(vertex) {
    let key = vertexKey(vertex)
    let groups = this.engine.libertyExercise?.groups || []
    return groups.some(g => !g.changed && vertexKey(g.vertex) === key)
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

// Pure fold over mistakesByGroup; returns per-group point values.
// Mirrors the rule in scoring.js: [10, 5, 0] for [0, 1, 2+] mistakes per group.
export function pointsByGroup(mistakesByGroup) {
  return mistakesByGroup.map(m => [10, 5, 0][Math.min(m, 2)])
}
