import config from './config.js'

// Compute the 5-star threshold in ms from engine state
export function computeThreshold(engine) {
  let allQuestions = engine.questionsAsked.flat()
  let groupCount = allQuestions.length
  let libSum = allQuestions.reduce((s, q) => s + Math.min(q.libCount, config.maxLibertyLabel), 0)
  return (engine.totalMoves * 1 + libSum * 0.5 + groupCount * 1) * 1000
}

// Compute star rating from score entry data
// scoreEntry must have: totalMs, mistakes, thresholdMs
export function computeStars(totalMs, mistakes, thresholdMs) {
  if (!thresholdMs || thresholdMs <= 0) return 0
  let ratio = totalMs / thresholdMs
  if (ratio <= 1 && mistakes === 0) return 5
  if (ratio <= 1.5) return 4
  if (ratio <= 2.5) return 3
  if (ratio <= 4) return 2
  return 1
}

// Compute stars directly from a score entry
export function starsFromScore(score) {
  if (!score || !score.thresholdMs) return 0
  return computeStars(score.totalMs, score.mistakes || 0, score.thresholdMs)
}

// How far the player was from the next-better star rating.
// Returns null if already at 5 stars, otherwise:
//   { nextStars, deltaMs, mistakesToRemove }
// nextStars is the better tier, deltaMs is the time needed to save (ms),
// mistakesToRemove is how many mistakes must be eliminated (only nonzero
// for the 4→5 jump, which additionally requires zero mistakes).
export function nextStarGap(totalMs, mistakes, thresholdMs) {
  let stars = computeStars(totalMs, mistakes, thresholdMs)
  if (stars === 5) return null
  let nextStars = stars + 1
  // Max ratio for each tier (totalMs / thresholdMs must be ≤ this for `tier` stars)
  let maxRatio = { 2: 4, 3: 2.5, 4: 1.5, 5: 1 }[nextStars]
  let deltaMs, mistakesToRemove = 0
  if (nextStars === 5) {
    // Need ratio ≤ 1 AND mistakes == 0; the time check is on elapsedMs (no penalty)
    let elapsedMs = totalMs - mistakes * 3000
    deltaMs = Math.max(0, elapsedMs - thresholdMs)
    mistakesToRemove = mistakes
  } else {
    deltaMs = Math.max(0, totalMs - thresholdMs * maxRatio)
  }
  return { nextStars, deltaMs, mistakesToRemove }
}
