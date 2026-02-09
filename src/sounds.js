let ctx = null
let streak = 0
let enabled = localStorage.getItem('sound') !== 'off'

export function isSoundEnabled() { return enabled }

export function toggleSound() {
  enabled = !enabled
  localStorage.setItem('sound', enabled ? 'on' : 'off')
  return enabled
}

function getCtx() {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

function playTone(freq, duration, type = 'sine') {
  if (!enabled) return
  let c = getCtx()
  let osc = c.createOscillator()
  let gain = c.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.001, c.currentTime)
  gain.gain.linearRampToValueAtTime(0.24, c.currentTime + 0.05)
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start()
  osc.stop(c.currentTime + duration)
}

export function playCorrect() {
  streak++
  // Each consecutive correct raises pitch by a semitone
  let freq = 330 * Math.pow(2, (streak - 1) / 12)
  playTone(freq, 0.35)
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
