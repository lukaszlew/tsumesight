#!/usr/bin/env node
// Generate synthetic canonical fixtures from deterministic scenarios.
// These complement the user-recorded fixtures in fixtures/ — they exist
// so Layer A coverage is not entirely dependent on the user's play
// habits.
//
// Each scenario:
//   1. Drives a fresh QuizSession through a sequence of events
//   2. Captures session.events (the event log just applied)
//   3. Computes goldens from the final session state
//   4. Emits fixtures/canonical--<name>.events.json
//
// Scenarios are hand-curated to cover: single-move, multi-move, capture,
// setup stones, rewind, force-commit, missed-group, and all-correct.
// Each SGF is small; every path is exercised.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { init, step, changedGroups, totalMistakes, mistakesByGroup, phase } from '../src/session.js'
import config from '../src/config.js'

const OUT_DIR = path.resolve(import.meta.dirname, '..', 'fixtures')
const SCHEMA_VERSION = 1
const EVENT_SCHEMA_VERSION = 2
const DEFAULT_CONFIG = { maxSubmits: config.maxSubmits, maxQuestions: 2 }

function sha256Hex(s) { return 'sha256:' + crypto.createHash('sha256').update(s).digest('hex') }

// Advance until phase is no longer 'showing'.
function dispatchAllAdvances(s) {
  while (phase(s) === 'showing') step(s, { kind: 'advance' })
}

// Tap the correct liberty count on every changed group (uses representative
// vertex from g.vertex — any stone of the group works, but the vertex is
// what's available without extra plumbing).
function markAllCorrect(s) {
  for (let g of changedGroups(s)) {
    let [x, y] = g.vertex.split ? g.vertex.split(',').map(Number) : g.vertex
    step(s, {
      kind: 'setMark',
      vertex: Array.isArray(g.vertex) ? g.vertex : [x, y],
      value: Math.min(g.libCount, config.maxLibertyLabel),
    })
  }
}

// Scenario list — deterministic closures that drive a session from init
// to a complete event log. Each returns {sgf, description, play(s)}.
const SCENARIOS = [
  {
    name: 'single-move-correct',
    description: 'Center stone, correct liberty count first submit',
    sgf: '(;SZ[9];B[ee])',
    play(s) { dispatchAllAdvances(s); markAllCorrect(s); step(s, { kind: 'submit' }) },
  },
  {
    name: 'single-move-wrong-then-correct',
    description: 'Wrong mark, submit, correct mark, submit',
    sgf: '(;SZ[9];B[ee])',
    play(s) {
      dispatchAllAdvances(s)
      step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })
      step(s, { kind: 'submit' })
      step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })
      step(s, { kind: 'submit' })
    },
  },
  {
    name: 'single-move-force-commit',
    description: 'Two wrong submits — force-commit at maxSubmits',
    sgf: '(;SZ[9];B[ee])',
    play(s) {
      dispatchAllAdvances(s)
      step(s, { kind: 'setMark', vertex: [4, 4], value: 2 })
      step(s, { kind: 'submit' })
      step(s, { kind: 'submit' })
    },
  },
  {
    name: 'single-move-missed-group',
    description: 'Submit with no marks; group shows as missed',
    sgf: '(;SZ[9];B[ee])',
    play(s) {
      dispatchAllAdvances(s)
      step(s, { kind: 'submit' })
      step(s, { kind: 'submit' })
    },
  },
  {
    name: 'rewind-then-solve',
    description: 'Wrong submit, rewind, replay, correct submit',
    sgf: '(;SZ[9];B[ba];W[aa])',
    play(s) {
      dispatchAllAdvances(s)
      step(s, { kind: 'setMark', vertex: [0, 0], value: 1 })
      step(s, { kind: 'submit' })
      step(s, { kind: 'rewind' })
      dispatchAllAdvances(s)
      markAllCorrect(s)
      step(s, { kind: 'submit' })
    },
  },
  {
    name: 'capture',
    description: 'Capture sequence (B[aa] captured by W[ba];W[ab])',
    sgf: '(;SZ[9];B[aa];W[ba];B[ee];W[ab])',
    play(s) { dispatchAllAdvances(s); markAllCorrect(s); step(s, { kind: 'submit' }) },
  },
  {
    name: 'setup-stones',
    description: 'Setup stones (AB/AW) + moves — setup groups can be pre-marked',
    sgf: '(;SZ[9]AB[dd][ed]AW[de][ee];B[cd];W[ce])',
    play(s) {
      dispatchAllAdvances(s)
      markAllCorrect(s)
      step(s, { kind: 'submit' })
    },
  },
  {
    name: 'multi-move-all-correct',
    description: 'Five-move sequence, all groups correct first try',
    sgf: '(;SZ[9];B[ee];W[aa];B[fe];W[ba];B[ge])',
    play(s) {
      dispatchAllAdvances(s)
      markAllCorrect(s)
      step(s, { kind: 'submit' })
    },
  },
  {
    name: 'large-liberty-capped',
    description: 'Center black stone on empty 9x9 has 4 libs — tests normal label',
    sgf: '(;SZ[9];B[ee])',
    play(s) {
      dispatchAllAdvances(s)
      step(s, { kind: 'setMark', vertex: [4, 4], value: 5 }) // wrong: value=5 means "5+"
      step(s, { kind: 'submit' })
      step(s, { kind: 'setMark', vertex: [4, 4], value: 4 })
      step(s, { kind: 'submit' })
    },
  },
]

function buildFixture({ name, description, sgf, play }) {
  let s = init(sgf, DEFAULT_CONFIG)
  play(s)
  // Canonical fixtures are synthetic; rewrite t values to event index
  // so regeneration is deterministic across machines and run speeds.
  for (let i = 0; i < s.events.length; i++) s.events[i].t = i

  let finalMarks = [...s.marks.entries()]
    .map(([key, m]) => ({ key, value: m.value, color: m.color }))
    .sort((a, b) => a.key.localeCompare(b.key))

  let changedGroupsVertices = changedGroups(s).map(g => g.vertex)
  let mistakes = totalMistakes(s)
  let mbg = mistakesByGroup(s)
  let groupCount = changedGroups(s).length
  let correct = Math.max(0, groupCount - mistakes)

  return {
    schemaVersion: SCHEMA_VERSION,
    sgf: {
      content: sgf,
      filename: `canonical-${name}.sgf`,
      path: 'canonical',
      contentHash: sha256Hex(sgf),
    },
    config: DEFAULT_CONFIG,
    recorded: {
      at: null, // synthetic; no wall-clock
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      viewport: null,
      rotated: null,
      source: 'canonical',
      description,
    },
    events: s.events,
    goldens: {
      // scoreEntry here omits the time-dependent fields (totalMs, cupMs,
      // accPoints, speedPoints, parScore) because canonical scenarios are
      // time-free. Scoring math is covered by scoring.test.js.
      scoreEntry: {
        correct,
        total: groupCount,
        accuracy: groupCount > 0 ? correct / groupCount : 1,
        mistakes,
        mistakesByGroup: mbg,
        groupCount,
      },
      finalMarks,
      submitResults: s.submitResults,
      changedGroupsVertices,
    },
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true })
let wrote = 0
for (let scenario of SCENARIOS) {
  let fixture = buildFixture(scenario)
  let outFile = path.join(OUT_DIR, `canonical--${scenario.name}.events.json`)
  fs.writeFileSync(outFile, JSON.stringify(fixture, null, 2) + '\n')
  wrote++
}
console.log(`Wrote ${wrote} canonical fixture${wrote === 1 ? '' : 's'} to ${OUT_DIR}/`)
