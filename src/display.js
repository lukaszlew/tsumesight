// Pure display-map construction for the Go board. Consumes a derived
// view (from derive.js) + session state + UI flags; produces signMap /
// markerMap / ghostStoneMap / paintMap ready for @sabaki/shudan's Goban.
//
// Rotation and group-display ordering are separate pure helpers so
// callers can test each layer in isolation.

import config from './config.js'

function makeEmptyMap(size, fill = null) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

function transpose(map) {
  let rows = map.length
  let cols = map[0].length
  return Array.from({ length: cols }, (_, x) => Array.from({ length: rows }, (_, y) => map[y][x]))
}

function libLabel(n) {
  return n >= config.maxLibertyLabel ? config.maxLibertyLabel + '+' : String(n)
}

// Build the four display maps for one frame. `view` comes from derive().
// `state` is the session state (for state.marks and state.hasExercise).
// `opts` = {isFinished, showSeqStones}.
export function buildMaps(view, state, { isFinished, showSeqStones }) {
  let engine = view.engine
  let size = engine.boardSize
  let inExercise = view.phase === 'exercise'

  let signMap
  if (isFinished && state.hasExercise) {
    // Final review: show all stones or initial position (eye toggle).
    signMap = (showSeqStones ? engine.trueBoard.signMap : engine.initialBoard.signMap).map(row => [...row])
  } else {
    signMap = engine.getDisplaySignMap()
  }
  let markerMap = makeEmptyMap(size)
  let ghostStoneMap = makeEmptyMap(size)
  let paintMap = makeEmptyMap(size, 0)

  // Show phase: opaque stone with move number for the just-played move.
  if (!isFinished && engine.currentMove && engine.showingMove) {
    let [x, y] = engine.currentMove.vertex
    signMap[y][x] = engine.currentMove.sign
    markerMap[y][x] = { type: 'label', label: String(engine.moveIndex) }
  }

  // Pre-marked (unchanged) groups show their fixed liberty count. Shown
  // during both exercise and finished review.
  let exercise = engine.libertyExercise
  if ((inExercise || isFinished) && exercise) {
    for (let g of exercise.groups) {
      if (g.changed) continue
      let [x, y] = g.vertex
      markerMap[y][x] = { type: 'label', label: libLabel(g.libCount) }
    }
  }

  // All user/eval marks live in state.marks with shape {value, color}.
  // Render them directly — no separate feedback overlay. Eval colors appear
  // after Done; user's next tap at the same intersection clears that color.
  if (inExercise || isFinished) {
    for (let [key, mark] of state.marks) {
      let [mx, my] = key.split(',').map(Number)
      let label = mark.value === '?' ? '?' : libLabel(mark.value)
      markerMap[my][mx] = { type: 'label', label }
      if (mark.color === 'green') paintMap[my][mx] = 1
      else if (mark.color === 'red') paintMap[my][mx] = -1
    }
  }

  return { signMap, markerMap, ghostStoneMap, paintMap }
}

// Rotate all four display maps (swap axes). Returns a new maps object
// with transposed arrays.
export function rotateMaps(maps) {
  return {
    signMap: transpose(maps.signMap),
    markerMap: transpose(maps.markerMap),
    ghostStoneMap: transpose(maps.ghostStoneMap),
    paintMap: transpose(maps.paintMap),
  }
}

// Order group indices by displayed board position (left-to-right,
// top-to-bottom). `groups` must expose `.vertex`; `rotated` swaps axes.
export function orderGroupsByDisplay(groups, rotated) {
  return groups.map((g, i) => i).sort((a, b) => {
    let va = groups[a].vertex, vb = groups[b].vertex
    let ax = rotated ? va[1] : va[0], ay = rotated ? va[0] : va[1]
    let bx = rotated ? vb[1] : vb[0], by = rotated ? vb[0] : vb[1]
    return ax - bx || ay - by
  })
}
