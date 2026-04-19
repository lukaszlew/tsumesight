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

import fs from 'node:fs'
import path from 'node:path'
import { init, step, mistakesByGroup, totalMistakes, changedGroups } from '../src/session.js'
import { computeParScore, computeAccPoints } from '../src/scoring.js'
import config from '../src/config.js'

let dir = path.resolve(import.meta.dirname, '..', 'fixtures')
let touched = 0
let unchanged = 0

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
  let parScore = computeParScore(total, maxTimeMs)
  let accPoints = computeAccPoints(mistakes, total)

  let se = fx.goldens?.scoreEntry
  if (!se) { unchanged++; continue }

  let changed = false
  let set = (k, v) => {
    // Treat numeric near-equal as equal (floating point safety for parScore/accuracy).
    let prev = se[k]
    let same = typeof v === 'number' && typeof prev === 'number'
      ? Math.abs(prev - v) < 1e-9
      : JSON.stringify(prev) === JSON.stringify(v)
    if (prev !== undefined && !same) { se[k] = v; changed = true }
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
  // Migrate legacy cupMs → maxTimeMs: if cupMs was present, the fixture
  // carries time-budget goldens and should now have maxTimeMs too.
  // Canonical fixtures that omit cupMs also omit maxTimeMs — leave them
  // minimal.
  if ('cupMs' in se) {
    if (se.maxTimeMs !== maxTimeMs) { se.maxTimeMs = maxTimeMs; changed = true }
    delete se.cupMs
    changed = true
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(fx, null, 2) + '\n')
    console.log(`updated  ${f}`)
    touched++
  } else {
    unchanged++
  }
}

console.log(`\n${touched} fixtures updated, ${unchanged} unchanged`)
