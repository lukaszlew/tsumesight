// Development config — toggle features here during development.
// These are compile-time constants; changes require page reload.

export default {
  // Liberty labels cap: groups with more liberties show "N+".
  // e.g. 5 means labels are 1, 2, 3, 4, 5+.
  maxLibertyLabel: 5,

  // Maximum number of Done presses per exercise. After this many submits,
  // the current marks are force-committed regardless of correctness.
  maxSubmits: 2,
}
