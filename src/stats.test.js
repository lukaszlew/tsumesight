import { describe, it, expect } from 'vitest'
import { computeStats } from './quiz.jsx'

describe('computeStats', () => {
  it('caps times at 5000ms', () => {
    let { avg } = computeStats([10000, 10000])
    expect(avg).toBe(5000)
  })

  it('does not cap times below 5000ms', () => {
    let { avg } = computeStats([1000, 3000])
    expect(avg).toBe(2000)
  })

  it('caps only the times above threshold', () => {
    let { avg } = computeStats([2000, 8000])
    // capped: [2000, 5000] → avg = 3500
    expect(avg).toBe(3500)
  })

  it('returns zero avg and sd for empty times', () => {
    let { avg, sd } = computeStats([])
    expect(avg).toBe(0)
    expect(sd).toBe(0)
  })

  it('returns zero sd for single time', () => {
    let { sd } = computeStats([3000])
    expect(sd).toBe(0)
  })

  it('computes sd correctly with cap', () => {
    // [1000, 9000] → capped [1000, 5000] → avg=3000, sd=2000
    let { avg, sd } = computeStats([1000, 9000])
    expect(avg).toBe(3000)
    expect(sd).toBe(2000)
  })

  it('respects custom cap', () => {
    let { avg } = computeStats([500, 2000], 1000)
    // capped: [500, 1000] → avg = 750
    expect(avg).toBe(750)
  })
})
