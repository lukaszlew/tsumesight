// Pure effect inference from session transitions.
//
// sideEffectsFor(next, event) — given the post-event state and the event
// that produced it, return an array of side-effect descriptors. The
// runner (in quiz.jsx) translates these into real actions (sounds,
// callbacks, DOM state updates). Keeping the decision pure lets the
// rules be tested without mocking the world.
//
// computeFinalizeData(state, ctx) — at finalize, compute everything
// needed to write the replay record, show the finish popup, and invoke
// the parent's onSolved callback. Mirrors the old inline checkFinished
// body but with ctx providing the bits that aren't in session state
// (loadTimeMs, viewport, rotated, sgfId, config).

import { phase, finalized, changedGroups, mistakesByGroup, totalMistakes, pointsByGroup } from './session.js'
import { computeStars, computeParScore, computeAccPoints, computeSpeedPoints } from './scoring.js'
import { orderGroupsByDisplay } from './display.js'

export function sideEffectsFor(next, event) {
  let out = []
  if (event.kind === 'advance') {
    // Stone click sound only if the advance kept us in 'showing' phase
    // (i.e., a stone was played). Activate-exercise advance → no sound.
    if (phase(next) === 'showing') out.push({ kind: 'sound/stoneClick' })
  } else if (event.kind === 'setMark') {
    out.push({ kind: 'sound/mark', value: event.value })
  } else if (event.kind === 'submit') {
    let lastResult = next.submitResults.at(-1) || []
    let allCorrect = lastResult.every(r => r.status === 'correct')
    if (finalized(next)) {
      out.push({ kind: allCorrect ? 'sound/correct' : 'sound/wrong' })
      let total = changedGroups(next).length
      let wrongCount = mistakesByGroup(next).filter(m => m > 0).length
      out.push({
        kind: 'onProgress',
        correct: allCorrect ? total : total - wrongCount,
        done: total,
        total,
      })
    } else {
      out.push({ kind: 'sound/wrong' })
      out.push({ kind: 'wrongFlash' })
    }
  }
  return out
}

// Build the payload needed at finalize. Pure except for reading
// performance.now() via ctx.loadTimeMs.
//
// ctx = { sgfId, config, loadTimeMs, rotated, viewport:{w,h} }
//
// Returns { date, stars, correct, total, scoreEntry, replayPayload,
//           popupData } for the runner to fan out.
export function computeFinalizeData(state, ctx) {
  let groups = changedGroups(state)
  let groupCount = groups.length
  let mistakes = totalMistakes(state)
  let mbg = mistakesByGroup(state)
  let elapsedMs = Math.round(performance.now() - ctx.loadTimeMs)
  // Cup time: base 3s + 1.5s per move + 1.5s per group.
  let cupMs = (3 + state.totalMoves * 1.5 + groupCount * 1.5) * 1000
  let parScore = computeParScore(groupCount, cupMs)
  let accPoints = computeAccPoints(mistakes, groupCount)
  let speedPoints = computeSpeedPoints(elapsedMs, cupMs)
  let stars = computeStars(accPoints, speedPoints, mistakes, parScore)

  let displayIdx = orderGroupsByDisplay(groups, ctx.rotated)
  let orderedPointsByGroup = displayIdx.map(i => pointsByGroup(mbg)[i])

  let correct = Math.max(0, groupCount - mistakes)
  let total = groupCount
  let accuracy = total > 0 ? correct / total : 1
  let date = Date.now()
  let scoreEntry = {
    correct, total, accuracy,
    totalMs: elapsedMs, mistakes, errors: mistakes, date,
    thresholdMs: cupMs, cupMs, parScore, accPoints, speedPoints, groupCount, mistakesByGroup: mbg,
  }

  let finalMarks = [...state.marks.entries()].map(([key, m]) => ({ key, value: m.value, color: m.color }))
  let changedGroupsVertices = groups.map(g => g.vertex)

  return {
    date,
    stars,
    correct,
    total,
    scoreEntry,
    // v:3 enriched record. Matches the fixture schema.
    replayPayload: {
      events: state.events,
      config: ctx.config,
      viewport: { w: ctx.viewport.w, h: ctx.viewport.h, rotated: ctx.rotated },
      goldens: {
        scoreEntry,
        finalMarks,
        submitResults: state.submitResults,
        changedGroupsVertices,
      },
    },
    popupData: {
      elapsedSec: Math.round(elapsedMs / 1000),
      mistakes, accPoints, speedPoints, stars, parScore,
      pointsByGroup: orderedPointsByGroup,
      maxGroups: 10 * groupCount,
      maxSpeed: Math.round(2 * (cupMs / 1000)),
    },
  }
}
