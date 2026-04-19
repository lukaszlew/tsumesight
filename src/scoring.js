import { h } from 'preact'

// Per-problem target score: perfect accuracy + finishing at cup time.
export function computeParScore(groupCount, cupMs) {
  return 20 * groupCount + (cupMs / 1000)
}

// Accuracy points: 20 per group, −10 per mistake (max 2 mistakes per group under 2-try cap).
export function computeAccPoints(mistakes, groupCount) {
  return Math.max(0, 20 * groupCount - 10 * mistakes)
}

// Speed points: 1 per second of headroom under 2×cup, 0 if slower.
export function computeSpeedPoints(elapsedMs, cupMs) {
  return Math.max(0, Math.round(2 * (cupMs / 1000) - elapsedMs / 1000))
}

// Stars from points: fractions of par score, with 5★ requiring 0 mistakes.
export function computeStars(accPoints, speedPoints, mistakes, parScore) {
  if (!parScore || parScore <= 0) return 0
  let ratio = (accPoints + speedPoints) / parScore
  if (ratio >= 1 && mistakes === 0) return 5
  if (ratio >= 0.75) return 4
  if (ratio >= 0.50) return 3
  if (ratio >= 0.25) return 2
  return 1
}

// Stars from a stored score entry. Handles both new and legacy formats.
export function starsFromScore(score) {
  if (!score) return 0
  if (score.accPoints != null && score.speedPoints != null && score.parScore != null) {
    return computeStars(score.accPoints, score.speedPoints, score.mistakes || 0, score.parScore)
  }
  // Legacy fallback: old ratio-based stars
  if (!score.thresholdMs) return 0
  let ratio = score.totalMs / score.thresholdMs
  if (ratio <= 1 && (score.mistakes || 0) === 0) return 5
  if (ratio <= 1.5) return 4
  if (ratio <= 2.5) return 3
  if (ratio <= 4) return 2
  return 1
}

// Gap to next star tier, in points and (for 4→5) mistakes to remove.
export function nextStarGap(accPoints, speedPoints, mistakes, parScore) {
  let stars = computeStars(accPoints, speedPoints, mistakes, parScore)
  if (stars === 5) return null
  let nextStars = stars + 1
  let minRatio = { 2: 0.25, 3: 0.50, 4: 0.75, 5: 1.0 }[nextStars]
  let need = minRatio * parScore
  let deltaPoints = Math.max(0, need - (accPoints + speedPoints))
  let mistakesToRemove = nextStars === 5 ? mistakes : 0
  return { nextStars, deltaPoints, mistakesToRemove }
}

// Render stars: trophy for 5, medal for 4, filled/empty stars for 0–3.
export function StarsDisplay({ stars, wrapClass, trophyClass, medalClass, offClass, onClass }) {
  if (stars >= 5) return h('span', { class: trophyClass }, starLabel(stars))
  if (stars === 4) return h('span', { class: medalClass || trophyClass }, starLabel(stars))
  return h('span', { class: wrapClass },
    [0, 1, 2].map(i => h('span', { key: i, class: i < stars ? onClass || '' : offClass }, i < stars ? '★' : '☆'))
  )
}

// Text label for a star count: trophy for 5, medal for 4, ★★☆ for 0–3.
export function starLabel(stars) {
  if (stars >= 5) return '🏆'
  if (stars === 4) return '🏅'
  return [0, 1, 2].map(i => i < stars ? '★' : '☆').join('')
}
