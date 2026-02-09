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

function playArpeggio(baseFreq) {
  if (!enabled) return
  let c = getCtx()
  // Quick ascending arpeggio: root → third → fifth → octave
  let ratios = [1, 5/4, 3/2, 2]
  ratios.forEach((ratio, i) => {
    let osc = c.createOscillator()
    let gain = c.createGain()
    let t = c.currentTime + i * 0.08
    osc.frequency.value = baseFreq * ratio
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.linearRampToValueAtTime(0.07, t + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.4)
  })
}

export function playCorrect() {
  streak++
  // Milestone every 5 streak: play a chord
  if (streak % 5 === 0) {
    playArpeggio(330 * Math.pow(2, streak / 12))
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
