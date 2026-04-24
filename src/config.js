// Development config — toggle features here during development.
// These are compile-time constants; changes require page reload.

export default {
  // Liberty labels cap: groups with more liberties show "N+".
  // e.g. 5 means labels are 1, 2, 3, 4, 5+.
  maxLibertyLabel: 5,

  // Maximum number of Done presses per exercise. After this many submits,
  // the current marks are force-committed regardless of correctness.
  maxSubmits: 3,

  // Per-group accuracy schedule indexed by mistake count: mᵢ=0,1,2,3+.
  // Length MUST be maxSubmits+1 — the last entry is the "3+" floor.
  // Changing these numbers reshapes accuracy scoring; see docs/SCORING.md.
  pointsByMistakes: [20, 12, 6, 0],

  // Duration (ms) of the red-flash on a wrong submit.
  wrongFlashMs: 150,

  // Time budget for speed bonus. The full max-time window in seconds is
  // 2 × (cupBaseSec + totalMoves·cupPerMoveSec + groupCount·cupPerGroupSec).
  // Config stays in per-move/per-group units so tuning "how much time per
  // move?" is natural; the doubling to produce the full window happens at
  // the effects.js call site.
  cupBaseSec: 3,
  cupPerMoveSec: 1.5,
  cupPerGroupSec: 1.5,
}
