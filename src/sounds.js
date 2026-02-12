import { kv, kvSet } from './db.js'

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
  if (!enabled) return
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
  if (!enabled) return
  let c = getCtx()
  // Shepard tone: multiple octaves with Gaussian amplitude envelope
  // Creates illusion of endlessly rising pitch without getting higher
  let t = ((streak - 1) % 12) / 12
  let base = 220 * Math.pow(2, t)
  let center = Math.log2(440)
  for (let freq of [base / 2, base, base * 2, base * 4]) {
    let dist = Math.log2(freq) - center
    let amp = 0.15 * Math.exp(-dist * dist * 4)
    if (amp < 0.005) continue
    let osc = c.createOscillator()
    let gain = c.createGain()
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.001, c.currentTime)
    gain.gain.linearRampToValueAtTime(amp, c.currentTime + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.35)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start()
    osc.stop(c.currentTime + 0.35)
  }
}

export function playWrong() {
  streak = 0
  playTone(130, 0.45, 'triangle')
}

export function playComplete() {
  if (!enabled) return
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
