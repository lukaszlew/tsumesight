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
  gain.gain.linearRampToValueAtTime(0.08, c.currentTime + 0.05)
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start()
  osc.stop(c.currentTime + duration)
}

function playChord(baseFreq) {
  if (!enabled) return
  let c = getCtx()
  // Major triad: root, major third, fifth
  for (let ratio of [1, 5/4, 3/2]) {
    let osc = c.createOscillator()
    let gain = c.createGain()
    osc.frequency.value = baseFreq * ratio
    gain.gain.setValueAtTime(0.001, c.currentTime)
    gain.gain.linearRampToValueAtTime(0.06, c.currentTime + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.6)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start()
    osc.stop(c.currentTime + 0.6)
  }
}

export function playCorrect() {
  streak++
  // Milestone every 5 streak: play a chord
  if (streak % 5 === 0) {
    playChord(330 * Math.pow(2, streak / 12))
    return
  }
  // Each consecutive correct raises pitch by a semitone
  let freq = 330 * Math.pow(2, (streak - 1) / 12)
  playTone(freq, 0.35)
}

export function playWrong() {
  streak = 0
  playTone(130, 0.45, 'triangle')
}
