// Development config — toggle features here during development.
// These are compile-time constants; changes require page reload.

export default {
  // Show the first move immediately when a new problem loads,
  // instead of requiring the user to tap/press space.
  autoShowFirstMove: false,

  // Liberty labels cap: groups with more liberties show "N+".
  // e.g. 5 means labels are 1, 2, 3, 4, 5+.
  maxLibertyLabel: 5,

  // Mark sound mode: how tapping a stone to cycle its liberty label sounds.
  //   'repeat'   — N short beeps for N, longer tone for max+
  //   'interval' — rising musical interval: 1=unison, max+=octave
  //   'pluck'    — plucked string with different timbre per number
  //   'interval_pluck' — interval frequencies with plucked string timbre
  markSoundMode: 'interval_pluck',
}
