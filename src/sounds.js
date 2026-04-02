import { kv, kvSet } from './db.js'
import config from './config.js'

let ctx = null
let streak = 0
let enabled = null

function getEnabled() {
  if (enabled === null) enabled = kv('sound', 'on') !== 'off'
  return enabled
}

export function isSoundEnabled() { return getEnabled() }
export function resetStreak() { streak = 0 }

export function toggleSound() {
  enabled = !getEnabled()
  kvSet('sound', enabled ? 'on' : 'off')
  return enabled
}

function getCtx() {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

function playTone(freq, duration, type = 'sine', vol = 0.24) {
  if (!getEnabled()) return
  let c = getCtx()
  let osc = c.createOscillator()
  let gain = c.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.001, c.currentTime)
  gain.gain.linearRampToValueAtTime(vol, c.currentTime + 0.05)
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start()
  osc.stop(c.currentTime + duration)
}

export function playCorrect() {
  streak++
  // Each consecutive correct raises pitch by a semitone, capped at one octave
  let freq = Math.min(220 * Math.pow(2, (streak - 1) / 12), 880)
  playTone(freq, 0.35)
}

export function playWrong() {
  streak = 0
  playTone(130, 0.45, 'triangle')
}

export function playStoneClick() {
  if (!getEnabled()) return
  let c = getCtx()
  let osc = c.createOscillator()
  let gain = c.createGain()
  osc.type = 'triangle'
  osc.frequency.value = 800
  gain.gain.setValueAtTime(0.15, c.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start()
  osc.stop(c.currentTime + 0.05)
}

// value: 0 = clear, 1..(max-1) = normal, max = capped (e.g. "5+")
export function playMark(value) {
  if (!getEnabled()) return
  let max = config.maxLibertyLabel
  let mode = config.markSoundMode

  if (mode === 'repeat') playMarkRepeat(value, max)
  else if (mode === 'interval') playMarkInterval(value, max)
  else if (mode === 'pluck') playMarkPluck(value, max)
  else if (mode === 'interval_pluck') playMarkIntervalPluck(value, max)
}

function playMarkRepeat(value, max) {
  let c = getCtx()
  if (value === 0) {
    // Clear: low descending tone
    playTone(300, 0.15, 'sine', 0.12)
    return
  }
  let isMax = value >= max
  let count = isMax ? max : value
  let gap = 0.08
  for (let i = 0; i < count; i++) {
    let t = c.currentTime + i * gap
    let osc = c.createOscillator()
    let gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    let dur = (i === count - 1 && isMax) ? 0.2 : 0.04
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.linearRampToValueAtTime(0.12, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start(t)
    osc.stop(t + dur)
  }
}

function playMarkInterval(value, max) {
  if (value === 0) {
    playTone(300, 0.15, 'sine', 0.12)
    return
  }
  // Spread from unison (ratio=1) to octave (ratio=2) across 1..max
  let ratio = 1 + (value - 1) / (max - 1)
  let base = 440
  let c = getCtx()
  // Play base and interval together
  let notes = [base, base * ratio]
  for (let freq of notes) {
    let osc = c.createOscillator()
    let gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.001, c.currentTime)
    gain.gain.linearRampToValueAtTime(0.1, c.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.25)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start()
    osc.stop(c.currentTime + 0.25)
  }
}

function playMarkPluck(value, max) {
  if (value === 0) {
    playTone(300, 0.15, 'sine', 0.12)
    return
  }
  let c = getCtx()
  // Different timbre per value: vary frequency, filter decay, and harmonic content
  // Spread base frequency from 300 to 700 across 1..max
  let freq = 300 + (value - 1) / (max - 1) * 400
  // Pluck: sharp attack, fast exponential decay, with harmonics
  let harmonics = [1, 2, 3, 4, 5]
  let decayBase = 0.08 + (max - value) / max * 0.15 // lower values ring longer
  for (let h of harmonics) {
    let osc = c.createOscillator()
    let gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq * h
    let vol = 0.12 / (h * h) // harmonics fall off
    let decay = decayBase / h
    gain.gain.setValueAtTime(vol, c.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + decay)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start()
    osc.stop(c.currentTime + decay)
  }
}

function pluckNote(c, freq, vol, decay) {
  let harmonics = [1, 2, 3, 4, 5]
  for (let h of harmonics) {
    let osc = c.createOscillator()
    let gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq * h
    let hVol = vol / (h * h)
    let hDecay = decay / h
    gain.gain.setValueAtTime(hVol, c.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + hDecay)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start()
    osc.stop(c.currentTime + hDecay)
  }
}

function playMarkIntervalPluck(value, max) {
  if (value === 0) {
    playTone(300, 0.15, 'sine', 0.12)
    return
  }
  let c = getCtx()
  // Interval: unison to octave, rendered as plucked strings
  let ratio = 1 + (value - 1) / (max - 1)
  let base = 330
  let notes = [base, base * ratio]
  for (let freq of notes) {
    pluckNote(c, freq, 0.06, 0.2)
  }
}

export function playComplete() {
  if (!getEnabled()) return
  let c = getCtx()
  // Ascending major chord with sustain: C5 → E5 → G5 → C6
  let freqs = [523, 659, 784, 1047]
  freqs.forEach((freq, i) => {
    let osc = c.createOscillator()
    let gain = c.createGain()
    let t = c.currentTime + i * 0.12
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.linearRampToValueAtTime(0.06, t + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.8)
  })
}
