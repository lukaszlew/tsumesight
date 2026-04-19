// View derivation for the quiz session. Packages session state + engine
// into a single object that display.js and quiz.jsx consume.
//
// Thin wrapper in P3 — engine still lives on state, so derive is mostly a
// rebinding of selectors. The narrow view surface lets later refactors
// (engine-out-of-state, memoized engine rebuild) land without touching
// consumers.

import { phase, finalized, changedGroups, isLockedVertex, mistakesByGroup } from './session.js'

export function derive(state) {
  return {
    engine: state.engine,
    phase: phase(state),
    finalized: finalized(state),
    changedGroups: changedGroups(state),
    isLockedVertex: v => isLockedVertex(state, v),
    mistakesByGroup: () => mistakesByGroup(state),
  }
}
