// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Track oscillator creations
let oscillatorsCreated = []

function makeMockCtx() {
  return {
    currentTime: 0,
    destination: {},
    createOscillator: vi.fn(() => {
      let osc = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
      oscillatorsCreated.push(osc)
      return osc
    }),
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    })),
  }
}

let mockCtx = makeMockCtx()
globalThis.AudioContext = vi.fn(function() { Object.assign(this, mockCtx) })

// Mock kv/kvSet
let kvStore = {}
vi.mock('./db.js', () => ({
  kv: (key, fallback) => kvStore[key] !== undefined ? kvStore[key] : fallback,
  kvSet: (key, value) => { kvStore[key] = value },
}))

describe('sounds', () => {
  beforeEach(() => {
    kvStore = {}
    oscillatorsCreated = []
    mockCtx = makeMockCtx()
    globalThis.AudioContext = vi.fn(function() { Object.assign(this, mockCtx) })
    vi.resetModules()
  })

  it('sound is enabled by default', async () => {
    let { isSoundEnabled } = await import('./sounds.js')
    expect(isSoundEnabled()).toBe(true)
  })

  it('toggleSound switches off then on', async () => {
    let { toggleSound, isSoundEnabled } = await import('./sounds.js')
    expect(isSoundEnabled()).toBe(true)
    expect(toggleSound()).toBe(false)
    expect(isSoundEnabled()).toBe(false)
    expect(toggleSound()).toBe(true)
    expect(isSoundEnabled()).toBe(true)
  })

  it('toggleSound persists to kv store', async () => {
    let { toggleSound } = await import('./sounds.js')
    toggleSound()
    expect(kvStore.sound).toBe('off')
    toggleSound()
    expect(kvStore.sound).toBe('on')
  })

  it('respects stored sound=off preference', async () => {
    kvStore.sound = 'off'
    let { isSoundEnabled } = await import('./sounds.js')
    expect(isSoundEnabled()).toBe(false)
  })

  it('playCorrect creates oscillator when enabled', async () => {
    let { playCorrect } = await import('./sounds.js')
    playCorrect()
    expect(oscillatorsCreated.length).toBe(1)
  })

  it('playCorrect does not create oscillator when disabled', async () => {
    kvStore.sound = 'off'
    let { playCorrect } = await import('./sounds.js')
    playCorrect()
    expect(oscillatorsCreated.length).toBe(0)
  })

  it('playWrong creates oscillator when enabled', async () => {
    let { playWrong } = await import('./sounds.js')
    playWrong()
    expect(oscillatorsCreated.length).toBe(1)
  })

  it('playComplete creates 4 oscillators for the chord', async () => {
    let { playComplete } = await import('./sounds.js')
    playComplete()
    expect(oscillatorsCreated.length).toBe(4)
  })

  it('playComplete does not create oscillators when disabled', async () => {
    kvStore.sound = 'off'
    let { playComplete } = await import('./sounds.js')
    playComplete()
    expect(oscillatorsCreated.length).toBe(0)
  })

  it('streak raises pitch on consecutive correct', async () => {
    let { playCorrect } = await import('./sounds.js')
    playCorrect()
    playCorrect()
    let freq1 = oscillatorsCreated[0].frequency.value
    let freq2 = oscillatorsCreated[1].frequency.value
    expect(freq2).toBeGreaterThan(freq1)
  })

  it('resetStreak resets pitch to base', async () => {
    let { playCorrect, resetStreak } = await import('./sounds.js')
    playCorrect()
    playCorrect()
    playCorrect()
    let highFreq = oscillatorsCreated[2].frequency.value
    resetStreak()
    playCorrect()
    let resetFreq = oscillatorsCreated[3].frequency.value
    expect(resetFreq).toBe(220)
    expect(resetFreq).toBeLessThan(highFreq)
  })

  it('playStoneClick creates oscillator when enabled', async () => {
    let { playStoneClick } = await import('./sounds.js')
    playStoneClick()
    expect(oscillatorsCreated.length).toBe(1)
    expect(oscillatorsCreated[0].type).toBe('triangle')
    expect(oscillatorsCreated[0].frequency.value).toBe(800)
  })

  it('playStoneClick does not create oscillator when disabled', async () => {
    kvStore.sound = 'off'
    let { playStoneClick } = await import('./sounds.js')
    playStoneClick()
    expect(oscillatorsCreated.length).toBe(0)
  })

  it('playWrong resets streak', async () => {
    let { playCorrect, playWrong } = await import('./sounds.js')
    playCorrect()
    playCorrect()
    let highFreq = oscillatorsCreated[1].frequency.value
    playWrong() // resets streak
    playCorrect()
    let afterWrongFreq = oscillatorsCreated[3].frequency.value // index 3: correct, correct, wrong, correct
    expect(afterWrongFreq).toBe(220)
    expect(afterWrongFreq).toBeLessThan(highFreq)
  })
})
