import { QuizEngine } from './engine.js'

// Sentinel value stored in state.marks for a "missed" changed group —
// no user mark was placed on any of its stones at submit time. Persisted
// as the string "?" because the value field round-trips through JSON
// (fixture goldens, v:3 replay records).
export const MISSED = '?'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function vertexKey(v) {
  return `${v[0]},${v[1]}`
}

// Quiz session — V4 shape.
//
// State (plain object, produced by `init`, advanced by `step`):
//   cursor       0..N+1     each advance produces one visible state change
//                           0     = before any advance (empty board)
//                           1..N  = showing move K (engine.showingMove=true)
//                           N+1   = past all moves (in exercise or finished)
//   marks        Map<key, {value, color}>
//                           value: number 1..maxLibertyLabel, or '?' sentinel
//                           color: null | 'green' | 'red'
//   submitCount  int        number of submits done
//   submitResults array     per-submit array of per-group statuses
//   events       []         canonical append-only log (source of truth)
//   engine       QuizEngine internal, mutated in place by step
//   startTime    number     performance.now() at first event; elapsedMs ref
//
// Phase, finalized, changedGroups, etc. are derived selectors.
//
// The QuizSession class at the bottom of this file is a thin wrapper
// that delegates to step + selectors and exposes state fields on
// `this`. It exists so existing tests and quiz.jsx (pre-P2) keep
// working verbatim while the step/init extraction is proved
// behavior-preserving by snapshot diffs.

export function init(sgf, { maxSubmits = 2, maxQuestions = 2 } = {}) {
  let engine = new QuizEngine(sgf, true, maxQuestions)
  return {
    sgf,
    maxSubmits,
    maxQuestions,
    engine,
    totalMoves: engine.totalMoves,
    cursor: 0,
    hasExercise: false,
    marks: new Map(),
    submitCount: 0,
    submitResults: [],
    events: [],
    startTime: null,
  }
}

// Apply a single event to state. Mutates engine, marks, arrays in place;
// returns the same state reference (a new reducer API shape — makes the
// migration to useReducer cheap). Locked-vertex setMark is a no-op and
// intentionally *not* recorded in the event log.
export function step(state, event) {
  if (state.startTime == null) state.startTime = performance.now()
  let t = event.t ?? Math.round(performance.now() - state.startTime)
  let recorded = { ...event, t }

  switch (event.kind) {
    case 'advance':
      _doAdvance(state)
      break
    case 'rewind':
      _doRewind(state)
      break
    case 'setMark':
      if (isLockedVertex(state, event.vertex)) return state
      _doSetMark(state, event.vertex, event.value)
      break
    case 'submit':
      _doSubmit(state)
      break
    default:
      throw new Error(`Unknown event kind: ${event.kind}`)
  }

  state.events.push(recorded)
  return state
}

// --- Pure selectors (state → value) ---

export function phase(state) {
  if (state.cursor <= state.totalMoves) return 'showing'
  if (!state.hasExercise) return 'finished'
  if (finalized(state)) return 'finished'
  return 'exercise'
}

export function finalized(state) {
  if (state.submitCount === 0) return false
  if (state.submitCount >= state.maxSubmits) return true
  let last = state.submitResults.at(-1)
  return last?.every(r => r.status === 'correct') === true
}

export function elapsedMs(state) {
  if (state.startTime == null) return 0
  return Math.round(performance.now() - state.startTime)
}

export function changedGroups(state) {
  return state.engine.libertyExercise?.groups.filter(g => g.changed) || []
}

// The representative intersection of a pre-marked (unchanged) group shows
// its fixed liberty count as a label. That specific intersection is not
// editable by the user. Other stones of the same group stay tappable.
export function isLockedVertex(state, vertex) {
  let key = vertexKey(vertex)
  let groups = state.engine.libertyExercise?.groups || []
  return groups.some(g => !g.changed && vertexKey(g.vertex) === key)
}

// Per-group: number of submits on which this group was not correct.
export function mistakesByGroup(state) {
  let n = changedGroups(state).length
  let counts = new Array(n).fill(0)
  for (let r of state.submitResults) {
    for (let i = 0; i < n; i++) {
      if (r[i]?.status !== 'correct') counts[i]++
    }
  }
  return counts
}

export function totalMistakes(state) {
  return mistakesByGroup(state).reduce((a, b) => a + b, 0)
}

// --- Private event handlers ---

function _doAdvance(state) {
  assert(state.cursor <= state.totalMoves, `advance at cursor=${state.cursor}/${state.totalMoves}`)
  if (state.cursor < state.totalMoves) {
    // Play and show the next move.
    state.engine.advance()
    state.cursor++
  } else {
    // cursor === totalMoves: last move is currently shown; activate the
    // exercise (or enter finished if no changed groups). No new stone is
    // played — this advance represents the user moving past the showing
    // state into the next phase.
    state.engine.activateQuestions()
    state.cursor++
    state.hasExercise = state.engine.libertyExerciseActive
  }
}

function _doRewind(state) {
  // Rebuild engine from scratch; preserve session-level state (marks,
  // submitCount, submitResults, startTime, events).
  state.engine = new QuizEngine(state.sgf, true, state.maxQuestions)
  state.cursor = 0
  state.hasExercise = false
}

function _doSetMark(state, vertex, value) {
  assert(state.cursor === state.totalMoves + 1, `setMark at cursor=${state.cursor}`)
  assert(!finalized(state), `setMark after finalized`)
  let key = vertexKey(vertex)
  if (value === 0) state.marks.delete(key)
  else state.marks.set(key, { value, color: null })
}

function _doSubmit(state) {
  assert(state.cursor === state.totalMoves + 1, `submit at cursor=${state.cursor}`)
  assert(state.hasExercise, `submit with no exercise`)
  assert(!finalized(state), `submit after finalized`)

  // Engine wants Map<key, number>. MISSED sentinels left over from
  // previous missed-group submits are filtered out (user never
  // intended them).
  let plain = new Map()
  for (let [k, m] of state.marks) {
    if (typeof m.value === 'number') plain.set(k, m.value)
  }
  let result = state.engine.checkLibertyExercise(plain)
  state.submitResults.push(result)
  state.submitCount++

  // Overwrite marks on each changed group's stones with the eval outcome.
  // User's intersection-level marks on the group are replaced by a single
  // entry reflecting the group's result (green/red on user's vertex, or
  // MISSED red on the representative vertex for missed).
  let groups = changedGroups(state)
  for (let i = 0; i < groups.length; i++) {
    let g = groups[i]
    let r = result[i]
    for (let k of g.chainKeys) state.marks.delete(k)
    if (r.status === 'correct') {
      state.marks.set(r.userVertex, { value: r.userVal, color: 'green' })
    } else if (r.status === 'wrong') {
      state.marks.set(r.userVertex, { value: r.userVal, color: 'red' })
    } else {
      // missed
      state.marks.set(vertexKey(g.vertex), { value: MISSED, color: 'red' })
    }
  }
}

// Pure fold over mistakesByGroup; returns per-group point values.
// Mirrors the rule in scoring.js: [10, 5, 0] for [0, 1, 2+] mistakes per group.
export function pointsByGroup(mistakesByGroup) {
  return mistakesByGroup.map(m => [10, 5, 0][Math.min(m, 2)])
}
