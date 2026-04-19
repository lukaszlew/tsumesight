#!/usr/bin/env node
// Re-fold each fixture's events through current session code and
// overwrite the recorded `scoreEntry.mistakes` / `.mistakesByGroup`
// (plus correct / accuracy derived from them) in-place.
//
// Use when a scoring-rule change (e.g. the "forgive one missed per
// submit" rule) shifts what the reducer considers a mistake. Without
// this, Layer A's goldens cross-check fails for every fixture that
// had the newly-affected pattern.
//
// Does NOT touch `finalMarks`, `submitResults`, `changedGroupsVertices`
// — those are structural and should stay as recorded.

import fs from 'node:fs'
import path from 'node:path'
import { init, step, mistakesByGroup, totalMistakes, changedGroups } from '../src/session.js'

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

  let se = fx.goldens?.scoreEntry
  if (!se) { unchanged++; continue }

  let changed = false
  if (se.mistakes !== mistakes) { se.mistakes = mistakes; changed = true }
  if (se.errors !== undefined && se.errors !== mistakes) { se.errors = mistakes; changed = true }
  if (JSON.stringify(se.mistakesByGroup) !== JSON.stringify(mbg)) { se.mistakesByGroup = mbg; changed = true }
  if (se.correct !== undefined && se.correct !== correct) { se.correct = correct; changed = true }
  if (se.accuracy !== undefined && Math.abs(se.accuracy - accuracy) > 1e-9) { se.accuracy = accuracy; changed = true }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(fx, null, 2) + '\n')
    console.log(`updated  ${f}`)
    touched++
  } else {
    unchanged++
  }
}

console.log(`\n${touched} fixtures updated, ${unchanged} unchanged`)
