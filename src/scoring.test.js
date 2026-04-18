import { describe, it, expect } from 'vitest'
import {
  computeParScore,
  computeAccPoints,
  computeSpeedPoints,
  computeStars,
  starsFromScore,
  nextStarGap,
  starLabel,
} from './scoring.js'

describe('computeParScore', () => {
  it('is 10 per group plus cup seconds', () => {
    expect(computeParScore(3, 10_000)).toBe(40)     // 30 + 10
    expect(computeParScore(0, 5_000)).toBe(5)
    expect(computeParScore(5, 0)).toBe(50)
  })
})

describe('computeAccPoints', () => {
  it('is 10 per group minus 5 per mistake, floored at 0', () => {
    expect(computeAccPoints(0, 3)).toBe(30)
    expect(computeAccPoints(1, 3)).toBe(25)
    expect(computeAccPoints(2, 3)).toBe(20)
    expect(computeAccPoints(6, 3)).toBe(0)   // 30-30
    expect(computeAccPoints(100, 3)).toBe(0) // clamped
  })
})

describe('computeSpeedPoints', () => {
  it('gives 1 point per second under 2x cup, rounded, floored at 0', () => {
    let cupMs = 10_000
    // elapsed 5s → 20 - 5 = 15
    expect(computeSpeedPoints(5_000, cupMs)).toBe(15)
    // elapsed 20s → 0
    expect(computeSpeedPoints(20_000, cupMs)).toBe(0)
    // elapsed 25s → clamped to 0
    expect(computeSpeedPoints(25_000, cupMs)).toBe(0)
    // rounding: 14.4s → 2*10 - 14.4 = 5.6 → round → 6
    expect(computeSpeedPoints(14_400, cupMs)).toBe(6)
  })
})

describe('computeStars', () => {
  it('5★ requires ratio >= 1.0 AND zero mistakes', () => {
    expect(computeStars(40, 0, 0, 40)).toBe(5)
    expect(computeStars(100, 0, 0, 40)).toBe(5)  // over-par still OK
    // Zero mistakes but ratio < 1 → 4★ at best
    expect(computeStars(30, 0, 0, 40)).toBe(4)   // 0.75
  })

  it('5★ downgraded to 4★ when mistakes > 0 even at full ratio', () => {
    expect(computeStars(40, 0, 1, 40)).toBe(4)
    expect(computeStars(100, 100, 5, 40)).toBe(4)
  })

  it('4/3/2/1 star tiers by ratio', () => {
    expect(computeStars(30, 0, 1, 40)).toBe(4)   // 0.75
    expect(computeStars(20, 0, 1, 40)).toBe(3)   // 0.50
    expect(computeStars(10, 0, 1, 40)).toBe(2)   // 0.25
    expect(computeStars(5, 0, 1, 40)).toBe(1)    // < 0.25
    expect(computeStars(0, 0, 1, 40)).toBe(1)    // floor is 1 star
  })

  it('returns 0 when parScore is missing or non-positive', () => {
    expect(computeStars(10, 10, 0, 0)).toBe(0)
    expect(computeStars(10, 10, 0, -1)).toBe(0)
    expect(computeStars(10, 10, 0, null)).toBe(0)
  })
})

describe('starsFromScore', () => {
  it('returns 0 for null/undefined', () => {
    expect(starsFromScore(null)).toBe(0)
    expect(starsFromScore(undefined)).toBe(0)
  })

  it('uses new-format fields when available', () => {
    let entry = { accPoints: 40, speedPoints: 0, parScore: 40, mistakes: 0 }
    expect(starsFromScore(entry)).toBe(5)
  })

  it('falls back to legacy ratio-based rules when new fields missing', () => {
    // ratio=1 (totalMs <= thresholdMs) + 0 mistakes → 5
    expect(starsFromScore({ totalMs: 5_000, thresholdMs: 5_000, mistakes: 0 })).toBe(5)
    // ratio > 1 → 4
    expect(starsFromScore({ totalMs: 6_000, thresholdMs: 5_000, mistakes: 0 })).toBe(4)
    // ratio 2 → 3
    expect(starsFromScore({ totalMs: 10_000, thresholdMs: 5_000, mistakes: 0 })).toBe(3)
    // ratio 3 → 2
    expect(starsFromScore({ totalMs: 15_000, thresholdMs: 5_000, mistakes: 0 })).toBe(2)
    // ratio 5 → 1
    expect(starsFromScore({ totalMs: 25_000, thresholdMs: 5_000, mistakes: 0 })).toBe(1)
    // legacy with mistakes: ratio=1 but mistakes>0 → downgraded to 4
    expect(starsFromScore({ totalMs: 5_000, thresholdMs: 5_000, mistakes: 1 })).toBe(4)
  })

  it('returns 0 when legacy fallback has no thresholdMs', () => {
    expect(starsFromScore({ totalMs: 5_000 })).toBe(0)
  })
})

describe('nextStarGap', () => {
  it('returns null at 5★', () => {
    expect(nextStarGap(40, 0, 0, 40)).toBeNull()
  })

  it('reports points needed to reach the next tier', () => {
    // At 4★ (30/40 = 0.75 with mistakes > 0): need ratio 1.0 and zero mistakes for 5★
    let gap = nextStarGap(30, 0, 2, 40)
    expect(gap.nextStars).toBe(5)
    expect(gap.deltaPoints).toBe(10)          // 40 - 30
    expect(gap.mistakesToRemove).toBe(2)
  })

  it('non-5★ transitions do not require removing mistakes', () => {
    // At 3★ (20/40 = 0.50): next tier 4★ needs 30/40 = 0.75
    let gap = nextStarGap(20, 0, 3, 40)
    expect(gap.nextStars).toBe(4)
    expect(gap.deltaPoints).toBe(10)          // 30 - 20
    expect(gap.mistakesToRemove).toBe(0)
  })

  it('deltaPoints floors at 0 when already past threshold', () => {
    // At 4★ with zero mistakes: gap to 5★ in points is 10 (40-30). Mistakes OK.
    let gap = nextStarGap(30, 0, 0, 40)
    expect(gap.deltaPoints).toBe(10)
    expect(gap.mistakesToRemove).toBe(0)
  })
})

describe('starLabel', () => {
  it('5★+ is trophy', () => {
    expect(starLabel(5)).toBe('🏆')
    expect(starLabel(7)).toBe('🏆')
  })

  it('4★ is medal', () => {
    expect(starLabel(4)).toBe('🏅')
  })

  it('0-3 render as filled/empty star chars', () => {
    expect(starLabel(0)).toBe('☆☆☆')
    expect(starLabel(1)).toBe('★☆☆')
    expect(starLabel(2)).toBe('★★☆')
    expect(starLabel(3)).toBe('★★★')
  })
})
