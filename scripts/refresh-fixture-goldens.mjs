#!/usr/bin/env node
// Re-fold each fixture's events through current session code and
// overwrite the recorded `scoreEntry` computed fields in-place:
//   mistakes, errors, mistakesByGroup, correct, accuracy,
//   accPoints, parScore, maxTimeMs, thresholdMs.
// Also deletes the legacy `cupMs` field if present (replaced by
// maxTimeMs).
//
// Use when a rule or coefficient change shifts what the reducer or
// scoring formulas produce for the same event stream. Without this,
// Layer A's goldens cross-check fails for every fixture that had
// the newly-affected pattern.
//
// Fields NOT touched (structural — stay as originally recorded):
//   finalMarks, submitResults, changedGroupsVertices,
//   speedPoints, totalMs, date, groupCount, total
//
// speedPoints and totalMs depend on wall-clock which we can't replay;
// `speedPoints` is effectively tied to the original recording. If a
// rule change shifts speedPoints' coefficient (currently 2·cupSec
// maximum), either write a dedicated updater or regenerate the source
// fixtures.
//
// Usage:
//   node scripts/refresh-fixture-goldens.mjs            # dry-run (prints per-field deltas; writes nothing)
//   node scripts/refresh-fixture-goldens.mjs --apply    # actually rewrite fixture files
//
// The dry-run / apply split is intentional: goldens must be reviewed
// before they're written. The dry-run prints the exact diff; only run
// --apply after eyeballing it.

import fs from 'node:fs'
import path from 'node:path'
import { init, step, mistakesByGroup, totalMistakes, changedGroups } from '../src/session.js'
import { computeParScore, computeAccPoints } from '../src/scoring.js'
import config from '../src/config.js'

let apply = process.argv.includes('--apply')

let dir = path.resolve(import.meta.dirname, '..', 'fixtures')
let touched = 0
let unchanged = 0
let fieldCounts = {}

for (let f of fs.readdirSync(dir)) {
  if (!f.endsWith('.events.json')) continue
  let filePath = path.join(dir, f)
  let fx = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  let s = init(fx.sgf.content, fx.config)
  for (let e of fx.events) step(s, e)

  let mbg = mistakesByGroup(s)
  let mistakes = totalMistakes(s)
  let total = changedGroups(s).length
  let correct = Math.max(0, total - mistakes)
  let accuracy = total > 0 ? correct / total : 1

  let maxTimeMs = 2 * (config.cupBaseSec + s.totalMoves * config.cupPerMoveSec + total * config.cupPerGroupSec) * 1000
  let schedule = config.pointsByMistakes
  let parScore = computeParScore(total, maxTimeMs, schedule)
  let accPoints = computeAccPoints(mbg, schedule)

  let se = fx.goldens?.scoreEntry
  if (!se) { unchanged++; continue }

  let deltas = []
  let set = (k, v) => {
    let prev = se[k]
    if (prev === undefined) return
    let same = typeof v === 'number' && typeof prev === 'number'
      ? Math.abs(prev - v) < 1e-9
      : JSON.stringify(prev) === JSON.stringify(v)
    if (!same) { deltas.push({ k, prev, next: v }); se[k] = v }
  }
  set('mistakes', mistakes)
  set('errors', mistakes)
  set('mistakesByGroup', mbg)
  set('correct', correct)
  set('accuracy', accuracy)
  set('accPoints', accPoints)
  set('parScore', parScore)
  set('thresholdMs', maxTimeMs / 2)
  set('maxTimeMs', maxTimeMs)
  if ('cupMs' in se) {
    if (se.maxTimeMs !== maxTimeMs) {
      deltas.push({ k: 'maxTimeMs', prev: se.maxTimeMs, next: maxTimeMs })
      se.maxTimeMs = maxTimeMs
    }
    deltas.push({ k: 'cupMs', prev: se.cupMs, next: '(deleted)' })
    delete se.cupMs
  }

  if (deltas.length === 0) { unchanged++; continue }
  touched++

  let fmt = v => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(6)) : JSON.stringify(v)
  console.log(`${apply ? 'updated ' : 'would update'}  ${f}`)
  for (let { k, prev, next } of deltas) {
    console.log(`    ${k}: ${fmt(prev)} → ${fmt(next)}`)
    fieldCounts[k] = (fieldCounts[k] || 0) + 1
  }

  if (apply) fs.writeFileSync(filePath, JSON.stringify(fx, null, 2) + '\n')
}

console.log()
if (Object.keys(fieldCounts).length > 0) {
  console.log('Fields changed (count across fixtures):')
  for (let k of Object.keys(fieldCounts).sort()) {
    console.log(`  ${k}: ${fieldCounts[k]}`)
  }
  console.log()
}
if (apply) {
  console.log(`${touched} fixtures updated, ${unchanged} unchanged`)
} else {
  console.log(`${touched} fixtures would be updated, ${unchanged} unchanged`)
  console.log(`\nDry-run only. Re-run with --apply to write changes.`)
}
