let ctx = null
let streak = 0

function getCtx() {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

function playTone(freq, duration, type = 'sine') {
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

export function playCorrect() {
  // Each consecutive correct raises pitch by a semitone (ratio 2^(1/12))
  let freq = 330 * Math.pow(2, streak / 12)
  playTone(freq, 0.35)
  streak++
}

export function playWrong() {
  streak = 0
  playTone(130, 0.45, 'triangle')
}
