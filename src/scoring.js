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
