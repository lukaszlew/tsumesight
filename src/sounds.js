import { kv, kvSet } from './db.js'

let ctx = null
let enabled = null

function getEnabled() {
  if (enabled === null) enabled = kv('sound', 'on') !== 'off'
  return enabled
}

export function isSoundEnabled() { return getEnabled() }

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
  playTone(440, 0.35)
}

export function playWrong() {
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
