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
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' })
  if (ctx.state === 'suspended') ctx.resume()
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
  if (!getEnabled()) return
  let c = getCtx()
  let t = c.currentTime
  for (let i = 0; i < 2; i++) {
    let osc = c.createOscillator()
    let gain = c.createGain()
    osc.type = 'triangle'
    osc.frequency.value = i === 0 ? 500 : 330
    gain.gain.setValueAtTime(0.3, t + i * 0.06)
    gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.08)
    osc.connect(gain).connect(c.destination)
    osc.start(t + i * 0.06); osc.stop(t + i * 0.06 + 0.08)
  }
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
  if (value === 0) {
    // Muted pluck: short triangle wave at 220Hz, fast decay
    let c = getCtx()
    let osc = c.createOscillator()
    let gain = c.createGain()
    osc.type = 'triangle'
    osc.frequency.value = 220
    gain.gain.setValueAtTime(0.4, c.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.03)
    osc.connect(gain).connect(c.destination)
    osc.start(); osc.stop(c.currentTime + 0.03)
    return
  }
  let max = config.maxLibertyLabel
  let mode = config.markSoundMode

  if (mode === 'repeat') playMarkRepeat(value, max)
  else if (mode === 'interval') playMarkInterval(value, max)
  else if (mode === 'pluck') playMarkPluck(value, max)
  else if (mode === 'interval_pluck') playMarkIntervalPluck(value, max)
}

function playMarkRepeat(value, max) {
  let c = getCtx()
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

function pluckNote(c, freq, vol, decay, t) {
  t = t || c.currentTime
  let harmonics = [1, 2, 3, 4, 5]
  for (let h of harmonics) {
    let osc = c.createOscillator()
    let gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq * h
    let hVol = vol / (h * h)
    let hDecay = decay / h
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.linearRampToValueAtTime(hVol, t + 0.003)
    gain.gain.exponentialRampToValueAtTime(0.001, t + hDecay)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start(t)
    osc.stop(t + hDecay)
  }
}

function playMarkIntervalPluck(value, max) {
  let c = getCtx()
  // Hold base → glide to target → hold target (2:6:6 ratio, 300ms total)
  let ratio = 1 + (value - 1) / (max - 1) * 2
  let base = 330, target = base * ratio
  let total = 0.1, sum = 2 + 6 + 6
  let hold1 = total * 2 / sum
  let glide = total * 6 / sum
  let t = c.currentTime
  let osc = c.createOscillator()
  let gain = c.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(base, t)
  osc.frequency.setValueAtTime(base, t + hold1)
  osc.frequency.linearRampToValueAtTime(target, t + hold1 + glide)
  gain.gain.setValueAtTime(0.15, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + total)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(t); osc.stop(t + total)
}

export function playComplete(stars = 0) {
  if (!getEnabled()) return
  if (stars >= 5) return playTrophy()
  if (stars >= 4) return playMedal()
  playBasicComplete()
}

// Pluck with harmonics
function schedulePluck(c, freq, t, vol, decay) {
  for (let h of [1, 2, 3, 4]) {
    let osc = c.createOscillator()
    let gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq * h
    let v = vol / (h * h)
    let d = decay / h
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.linearRampToValueAtTime(v, t + 0.003)
    gain.gain.exponentialRampToValueAtTime(0.001, t + d)
    osc.connect(gain).connect(c.destination)
    osc.start(t); osc.stop(t + d)
  }
}

// Basic (0-3 stars): quick plucked triad C E G
function playBasicComplete() {
  let c = getCtx()
  let t0 = c.currentTime
  schedulePluck(c, 523, t0, 0.18, 0.3)
  schedulePluck(c, 659, t0 + 0.07, 0.18, 0.3)
  schedulePluck(c, 784, t0 + 0.14, 0.18, 0.5)
}

// Medal (4 stars): pluck triad → single high pluck that rings long
export function playMedal() {
  let c = getCtx()
  let t0 = c.currentTime
  schedulePluck(c, 523, t0, 0.16, 0.25)
  schedulePluck(c, 659, t0 + 0.07, 0.16, 0.25)
  schedulePluck(c, 784, t0 + 0.14, 0.16, 0.3)
  schedulePluck(c, 1568, t0 + 0.28, 0.2, 1.0)
}

// Trophy (5 stars): triple plucked bursts ascending + big pluck chord
export function playTrophy() {
  let c = getCtx()
  let t0 = c.currentTime
  let bursts = [[523, 659, 784], [659, 784, 988], [784, 988, 1175]]
  bursts.forEach((burst, bi) => {
    burst.forEach((f, i) => schedulePluck(c, f, t0 + bi * 0.22 + i * 0.05, 0.14, 0.25))
  })
  let chordT = t0 + 0.78
  for (let f of [1047, 1319, 1568, 2093]) schedulePluck(c, f, chordT, 0.14, 1.2)
}

