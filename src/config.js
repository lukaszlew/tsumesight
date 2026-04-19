// Development config — toggle features here during development.
// These are compile-time constants; changes require page reload.

export default {
  // Liberty labels cap: groups with more liberties show "N+".
  // e.g. 5 means labels are 1, 2, 3, 4, 5+.
  maxLibertyLabel: 5,

  // Maximum number of Done presses per exercise. After this many submits,
  // the current marks are force-committed regardless of correctness.
  maxSubmits: 2,

  // Duration (ms) of the red-flash on a wrong submit.
  wrongFlashMs: 150,

  // Par time: cupMs = (cupBaseSec + totalMoves*cupPerMoveSec + groups*cupPerGroupSec) * 1000
  // Used by scoring.js:computeSpeedPoints to set the "comfortable" completion time.
  cupBaseSec: 3,
  cupPerMoveSec: 1.5,
  cupPerGroupSec: 1.5,
}
