import { describe, it, expect } from 'vitest'
import { getWheelZone } from './quiz-wheel.jsx'

// Pure angle → zone mapping. Six zones centered at 30° intervals starting
// at 270° (north, because screen Y grows downward):
//
//   zone 0 @ 270°  (value 0 = clear mark)
//   zone 1 @ 330°  (value 1)
//   zone 2 @  30°  (value 2)
//   zone 3 @  90°  (value 3)
//   zone 4 @ 150°  (value 4)
//   zone 5 @ 210°  (value 5+)
//
// Each zone spans ±30° around its center.

describe('getWheelZone — cardinal directions', () => {
  it('straight up (screen -y) → zone 0', () => {
    expect(getWheelZone(0, -1)).toBe(0)
  })
  it('straight right (screen +x) → zone 2', () => {
    expect(getWheelZone(1, 0)).toBe(2)
  })
  it('straight down (screen +y) → zone 3', () => {
    expect(getWheelZone(0, 1)).toBe(3)
  })
  it('straight left (screen -x) → zone 5', () => {
    expect(getWheelZone(-1, 0)).toBe(5)
  })
})

describe('getWheelZone — intermediate directions', () => {
  it('NE flick (dx=+, dy=-) → zone 1', () => {
    // atan2(-1, 1) = -45° = 315°; still within 300–360° range (zone 1).
    expect(getWheelZone(1, -1)).toBe(1)
  })
  it('SE flick (dx=+, dy=+) → zone 2', () => {
    // atan2(1, 1) = 45°; within 0–60° (zone 2).
    expect(getWheelZone(1, 1)).toBe(2)
  })
  it('SW flick (dx=-, dy=+) → zone 4', () => {
    // atan2(1, -1) = 135°; within 120–180° (zone 4).
    expect(getWheelZone(-1, 1)).toBe(4)
  })
  it('NW flick (dx=-, dy=-) → zone 5', () => {
    // atan2(-1, -1) = -135° = 225°; within 180–240° (zone 5).
    expect(getWheelZone(-1, -1)).toBe(5)
  })
})

describe('getWheelZone — zone-center angles (unambiguous)', () => {
  // Zone centers are 60° apart starting at 270° (north). Test a vector
  // pointing at each center to confirm the mapping.
  it('330° (NNE) → zone 1', () => {
    // atan2(-1, √3) = -30° = 330°; center of zone 1.
    expect(getWheelZone(Math.sqrt(3), -1)).toBe(1)
  })
  it('150° (SSW) → zone 4', () => {
    // atan2(1, -√3) = 150°; center of zone 4.
    expect(getWheelZone(-Math.sqrt(3), 1)).toBe(4)
  })
  it('210° (WNW) → zone 5', () => {
    // atan2(-1, -√3) = -150° = 210°; center of zone 5.
    expect(getWheelZone(-Math.sqrt(3), -1)).toBe(5)
  })
})

describe('getWheelZone — large magnitudes', () => {
  it('is magnitude-independent (only direction matters)', () => {
    expect(getWheelZone(1000, 0)).toBe(2)
    expect(getWheelZone(0.0001, 0)).toBe(2)
  })
})
