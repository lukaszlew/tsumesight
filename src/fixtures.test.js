// Layer A — fold fixture events through QuizSession, snapshot derived
// view at each step, cross-check goldens. This is the primary regression
// safety net for the V4 refactor.
//
// For each fixture under fixtures/:
//   1. Load {sgf, config, events, goldens}
//   2. Fresh QuizSession(sgf, config)
//   3. Apply events one by one, snapshotting state between each
//   4. After the last event, cross-check against goldens where present
//
// Snapshots live at fixtures/__snapshots__/<fixture-basename>.snap.json
// (one file per fixture, committed to the repo, readable in diffs).

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { QuizSession } from './session.js'

const fixturesDir = path.resolve(import.meta.dirname, '..', 'fixtures')
const snapshotsDir = path.join(fixturesDir, '__snapshots__')

function loadFixtures() {
  if (!fs.existsSync(fixturesDir)) return []
  return fs.readdirSync(fixturesDir)
    .filter(f => f.endsWith('.events.json'))
    .sort()
    .map(f => ({
      name: f.replace(/\.events\.json$/, ''),
      data: JSON.parse(fs.readFileSync(path.join(fixturesDir, f), 'utf8')),
    }))
}

// Serialize a session's observable state to a plain object. Deterministic
// ordering so snapshots don't churn. Deep-clones reference-shared fields
// (submitResults) so each timeline entry captures a point-in-time view
// rather than the end state.
function snapshotState(s) {
  let marks = [...s.marks.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  return {
    cursor: s.cursor,
    phase: s.phase,
    hasExercise: s.hasExercise,
    submitCount: s.submitCount,
    finalized: s.finalized,
    marks: marks.map(([k, m]) => ({ key: k, value: m.value, color: m.color })),
    submitResults: s.submitResults.map(r => r.map(x => ({ ...x }))),
    mistakesByGroup: s.finalized || s.phase === 'finished' ? s.mistakesByGroup() : null,
  }
}

const fixtures = loadFixtures()

describe('Layer A — fold fixture events through QuizSession', () => {
  if (fixtures.length === 0) {
    it.skip('no fixtures found (expected in CI before P0.2 lands)', () => {})
    return
  }

  for (let { name, data } of fixtures) {
    it(`${name}: fold events and snapshot derived view`, async () => {
      let s = new QuizSession(data.sgf.content, data.config)
      let timeline = [{ event: null, state: snapshotState(s) }]
      for (let evt of data.events) {
        s.applyEvent(evt)
        timeline.push({ event: evt, state: snapshotState(s) })
      }
      let snapshot = {
        totalMoves: s.totalMoves,
        eventCount: data.events.length,
        finalPhase: s.phase,
        timeline,
      }
      await expect(JSON.stringify(snapshot, null, 2))
        .toMatchFileSnapshot(path.join(snapshotsDir, `${name}.snap.json`))
    })

    // Golden cross-checks (only fire when fixture has corresponding golden).
    it(`${name}: goldens cross-check`, () => {
      let s = new QuizSession(data.sgf.content, data.config)
      for (let evt of data.events) s.applyEvent(evt)
      let g = data.goldens || {}

      if (g.scoreEntry) {
        expect(s.totalMistakes(), 'total mistakes').toBe(g.scoreEntry.mistakes)
        expect(s.changedGroups.length, 'changed groups count').toBe(g.scoreEntry.total)
        expect(s.mistakesByGroup(), 'mistakes per group').toEqual(g.scoreEntry.mistakesByGroup)
      }
      if (g.finalMarks) {
        let actual = [...s.marks.entries()]
          .map(([key, m]) => ({ key, value: m.value, color: m.color }))
          .sort((a, b) => a.key.localeCompare(b.key))
        let expected = [...g.finalMarks].sort((a, b) => a.key.localeCompare(b.key))
        expect(actual).toEqual(expected)
      }
      if (g.submitResults) {
        expect(s.submitResults).toEqual(g.submitResults)
      }
      if (g.changedGroupsVertices) {
        expect(s.changedGroups.map(cg => cg.vertex)).toEqual(g.changedGroupsVertices)
      }
    })
  }
})
