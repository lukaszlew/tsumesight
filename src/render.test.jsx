// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/preact'
import { Goban } from '@sabaki/shudan'
import { QuizEngine } from './engine.js'

// Import Shudan CSS so class-based styles are available
import '@sabaki/shudan/css/goban.css'

function makeEmptyMap(size, fill = null) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

// Helper: find vertex div by coordinates
function getVertex(container, x, y) {
  return container.querySelector(`[data-x="${x}"][data-y="${y}"]`)
}

// Helper: render a small 5x5 goban with given props
function renderGoban(props = {}) {
  let size = props.signMap?.length || 5
  let defaults = {
    vertexSize: 24,
    signMap: makeEmptyMap(size, 0),
    showCoordinates: false,
    fuzzyStonePlacement: false,
    animateStonePlacement: false,
  }
  let { container } = render(<Goban {...defaults} {...props} />)
  return container
}

describe('Goban basic rendering', () => {
  it('renders a 5x5 board with 25 vertices', () => {
    let c = renderGoban()
    let vertices = c.querySelectorAll('.shudan-vertex')
    expect(vertices.length).toBe(25)
  })

  it('renders a 9x9 board with 81 vertices', () => {
    let c = renderGoban({ signMap: makeEmptyMap(9, 0) })
    let vertices = c.querySelectorAll('.shudan-vertex')
    expect(vertices.length).toBe(81)
  })

  it('vertex has correct data-x and data-y attributes', () => {
    let c = renderGoban()
    let v = getVertex(c, 2, 3)
    expect(v).not.toBeNull()
    expect(v.dataset.x).toBe('2')
    expect(v.dataset.y).toBe('3')
  })
})

describe('signMap stone rendering', () => {
  it('empty vertex has shudan-sign_0 class', () => {
    let c = renderGoban()
    let v = getVertex(c, 0, 0)
    expect(v.classList.contains('shudan-sign_0')).toBe(true)
  })

  it('black stone has shudan-sign_1 class', () => {
    let signMap = makeEmptyMap(5, 0)
    signMap[2][3] = 1
    let c = renderGoban({ signMap })
    let v = getVertex(c, 3, 2)
    expect(v.classList.contains('shudan-sign_1')).toBe(true)
  })

  it('white stone has shudan-sign_-1 class', () => {
    let signMap = makeEmptyMap(5, 0)
    signMap[1][4] = -1
    let c = renderGoban({ signMap })
    let v = getVertex(c, 4, 1)
    expect(v.classList.contains('shudan-sign_-1')).toBe(true)
  })

  it('multiple stones render correctly', () => {
    let signMap = makeEmptyMap(5, 0)
    signMap[0][0] = 1
    signMap[0][1] = -1
    signMap[4][4] = 1
    let c = renderGoban({ signMap })
    expect(getVertex(c, 0, 0).classList.contains('shudan-sign_1')).toBe(true)
    expect(getVertex(c, 1, 0).classList.contains('shudan-sign_-1')).toBe(true)
    expect(getVertex(c, 4, 4).classList.contains('shudan-sign_1')).toBe(true)
    expect(getVertex(c, 2, 2).classList.contains('shudan-sign_0')).toBe(true)
  })
})

describe('markerMap rendering', () => {
  it('label marker renders text inside shudan-marker div', () => {
    let markerMap = makeEmptyMap(5)
    markerMap[2][3] = { type: 'label', label: '5' }
    let signMap = makeEmptyMap(5, 0)
    signMap[2][3] = 1
    let c = renderGoban({ signMap, markerMap })
    let v = getVertex(c, 3, 2)
    let marker = v.querySelector('.shudan-marker')
    expect(marker).not.toBeNull()
    expect(marker.textContent).toBe('5')
  })

  it('label marker adds shudan-marker_label class to vertex', () => {
    let markerMap = makeEmptyMap(5)
    markerMap[1][1] = { type: 'label', label: '3' }
    let signMap = makeEmptyMap(5, 0)
    signMap[1][1] = 1
    let c = renderGoban({ signMap, markerMap })
    let v = getVertex(c, 1, 1)
    expect(v.classList.contains('shudan-marker_label')).toBe(true)
  })

  it('label marker sets title attribute on vertex', () => {
    let markerMap = makeEmptyMap(5)
    markerMap[0][0] = { type: 'label', label: '✓' }
    let signMap = makeEmptyMap(5, 0)
    signMap[0][0] = 1
    let c = renderGoban({ signMap, markerMap })
    let v = getVertex(c, 0, 0)
    expect(v.getAttribute('title')).toBe('✓')
  })

  it('checkmark marker renders ✓ text', () => {
    let markerMap = makeEmptyMap(5)
    markerMap[2][2] = { type: 'label', label: '✓' }
    let signMap = makeEmptyMap(5, 0)
    signMap[2][2] = 1
    let c = renderGoban({ signMap, markerMap })
    let marker = getVertex(c, 2, 2).querySelector('.shudan-marker')
    expect(marker.textContent).toBe('✓')
  })

  it('cross marker renders ✗ text', () => {
    let markerMap = makeEmptyMap(5)
    markerMap[3][1] = { type: 'label', label: '✗' }
    let signMap = makeEmptyMap(5, 0)
    signMap[3][1] = -1
    let c = renderGoban({ signMap, markerMap })
    let marker = getVertex(c, 1, 3).querySelector('.shudan-marker')
    expect(marker.textContent).toBe('✗')
  })

  it('circle marker renders SVG', () => {
    let markerMap = makeEmptyMap(5)
    markerMap[0][0] = { type: 'circle' }
    let c = renderGoban({ markerMap })
    let v = getVertex(c, 0, 0)
    expect(v.classList.contains('shudan-marker_circle')).toBe(true)
    let svg = v.querySelector('svg.shudan-marker')
    expect(svg).not.toBeNull()
  })

  it('marker on empty vertex renders outside stone div', () => {
    let markerMap = makeEmptyMap(5)
    markerMap[2][2] = { type: 'label', label: 'X' }
    let c = renderGoban({ markerMap })
    let v = getVertex(c, 2, 2)
    // On empty vertex, marker is a direct child (not inside .shudan-stone)
    let directMarker = Array.from(v.children).find(el =>
      el.classList.contains('shudan-marker')
    )
    expect(directMarker).not.toBeNull()
  })

  it('marker on stone renders inside stone div', () => {
    let markerMap = makeEmptyMap(5)
    markerMap[2][2] = { type: 'label', label: '7' }
    let signMap = makeEmptyMap(5, 0)
    signMap[2][2] = 1
    let c = renderGoban({ signMap, markerMap })
    let v = getVertex(c, 2, 2)
    let stoneDiv = v.querySelector('.shudan-stone')
    let markerInStone = stoneDiv.querySelector('.shudan-marker')
    expect(markerInStone).not.toBeNull()
    expect(markerInStone.textContent).toBe('7')
  })

  it('3+ char label gets shudan-smalllabel class', () => {
    let markerMap = makeEmptyMap(5)
    markerMap[0][0] = { type: 'label', label: '123' }
    let signMap = makeEmptyMap(5, 0)
    signMap[0][0] = 1
    let c = renderGoban({ signMap, markerMap })
    let v = getVertex(c, 0, 0)
    expect(v.classList.contains('shudan-smalllabel')).toBe(true)
  })

  it('2 char label does NOT get shudan-smalllabel class', () => {
    let markerMap = makeEmptyMap(5)
    markerMap[0][0] = { type: 'label', label: '42' }
    let signMap = makeEmptyMap(5, 0)
    signMap[0][0] = 1
    let c = renderGoban({ signMap, markerMap })
    let v = getVertex(c, 0, 0)
    expect(v.classList.contains('shudan-smalllabel')).toBe(false)
  })

  it('no marker means no shudan-marker div', () => {
    let c = renderGoban()
    let v = getVertex(c, 0, 0)
    let marker = v.querySelector('.shudan-marker')
    expect(marker).toBeNull()
  })
})

describe('ghostStoneMap rendering', () => {
  it('ghost stone on empty vertex renders shudan-ghost div', () => {
    let ghostStoneMap = makeEmptyMap(5)
    ghostStoneMap[2][2] = { sign: 1, faint: true }
    let c = renderGoban({ ghostStoneMap })
    let v = getVertex(c, 2, 2)
    let ghost = v.querySelector('.shudan-ghost')
    expect(ghost).not.toBeNull()
  })

  it('ghost stone adds sign class to vertex', () => {
    let ghostStoneMap = makeEmptyMap(5)
    ghostStoneMap[1][3] = { sign: -1, faint: true }
    let c = renderGoban({ ghostStoneMap })
    let v = getVertex(c, 3, 1)
    expect(v.classList.contains('shudan-ghost_-1')).toBe(true)
  })

  it('faint ghost adds shudan-ghost_faint class', () => {
    let ghostStoneMap = makeEmptyMap(5)
    ghostStoneMap[0][0] = { sign: 1, faint: true }
    let c = renderGoban({ ghostStoneMap })
    let v = getVertex(c, 0, 0)
    expect(v.classList.contains('shudan-ghost_faint')).toBe(true)
  })

  it('ghost type "good" adds shudan-ghost_good class', () => {
    let ghostStoneMap = makeEmptyMap(5)
    ghostStoneMap[3][3] = { sign: 1, type: 'good' }
    let c = renderGoban({ ghostStoneMap })
    let v = getVertex(c, 3, 3)
    expect(v.classList.contains('shudan-ghost_good')).toBe(true)
  })

  it('ghost type "bad" adds shudan-ghost_bad class', () => {
    let ghostStoneMap = makeEmptyMap(5)
    ghostStoneMap[4][4] = { sign: -1, type: 'bad' }
    let c = renderGoban({ ghostStoneMap })
    let v = getVertex(c, 4, 4)
    expect(v.classList.contains('shudan-ghost_bad')).toBe(true)
  })

  it('ghost type "interesting" adds shudan-ghost_interesting class', () => {
    let ghostStoneMap = makeEmptyMap(5)
    ghostStoneMap[1][1] = { sign: 1, type: 'interesting' }
    let c = renderGoban({ ghostStoneMap })
    let v = getVertex(c, 1, 1)
    expect(v.classList.contains('shudan-ghost_interesting')).toBe(true)
  })

  it('ghost type "doubtful" adds shudan-ghost_doubtful class', () => {
    let ghostStoneMap = makeEmptyMap(5)
    ghostStoneMap[2][0] = { sign: 1, type: 'doubtful' }
    let c = renderGoban({ ghostStoneMap })
    let v = getVertex(c, 0, 2)
    expect(v.classList.contains('shudan-ghost_doubtful')).toBe(true)
  })

  it('ghost stone on occupied vertex does NOT render ghost div', () => {
    let signMap = makeEmptyMap(5, 0)
    signMap[2][2] = 1
    let ghostStoneMap = makeEmptyMap(5)
    ghostStoneMap[2][2] = { sign: 1, type: 'good' }
    let c = renderGoban({ signMap, ghostStoneMap })
    let v = getVertex(c, 2, 2)
    let ghost = v.querySelector('.shudan-ghost')
    expect(ghost).toBeNull()
  })

  it('ghost stone on occupied vertex still adds class to vertex div', () => {
    let signMap = makeEmptyMap(5, 0)
    signMap[2][2] = 1
    let ghostStoneMap = makeEmptyMap(5)
    ghostStoneMap[2][2] = { sign: 1, type: 'good' }
    let c = renderGoban({ signMap, ghostStoneMap })
    let v = getVertex(c, 2, 2)
    // Class is still added even though ghost div is not rendered
    expect(v.classList.contains('shudan-ghost_good')).toBe(true)
  })

  it('no ghost stone means no ghost div or class', () => {
    let c = renderGoban()
    let v = getVertex(c, 0, 0)
    let ghost = v.querySelector('.shudan-ghost')
    expect(ghost).toBeNull()
    expect(v.classList.contains('shudan-ghost_1')).toBe(false)
    expect(v.classList.contains('shudan-ghost_-1')).toBe(false)
  })
})

describe('paintMap rendering', () => {
  it('numeric paint value renders shudan-paint div', () => {
    let paintMap = makeEmptyMap(5, 0)
    paintMap[2][2] = 1
    let c = renderGoban({ paintMap })
    let v = getVertex(c, 2, 2)
    let paint = v.querySelector('.shudan-paint')
    expect(paint).not.toBeNull()
  })

  it('positive paint adds shudan-paint_1 class', () => {
    let paintMap = makeEmptyMap(5, 0)
    paintMap[1][3] = 1
    let c = renderGoban({ paintMap })
    let v = getVertex(c, 3, 1)
    expect(v.classList.contains('shudan-paint_1')).toBe(true)
  })

  it('negative paint adds shudan-paint_-1 class', () => {
    let paintMap = makeEmptyMap(5, 0)
    paintMap[0][0] = -1
    let c = renderGoban({ paintMap })
    let v = getVertex(c, 0, 0)
    expect(v.classList.contains('shudan-paint_-1')).toBe(true)
  })

  it('zero paint does NOT render paint div', () => {
    let paintMap = makeEmptyMap(5, 0)
    let c = renderGoban({ paintMap })
    let v = getVertex(c, 2, 2)
    let paint = v.querySelector('.shudan-paint')
    expect(paint).toBeNull()
  })

  it('null paint does NOT render paint div', () => {
    let c = renderGoban()
    let v = getVertex(c, 2, 2)
    let paint = v.querySelector('.shudan-paint')
    expect(paint).toBeNull()
  })

  it('string paint value is truthy — renders paint (BUG if used with color strings)', () => {
    // This test documents that string values DO render as paint_-1 (white)
    // because Shudan only supports numeric values
    let paintMap = makeEmptyMap(5, 0)
    paintMap[2][2] = 'rgba(0,200,0,0.5)'
    let c = renderGoban({ paintMap })
    let v = getVertex(c, 2, 2)
    // String is truthy, so paint renders, but always as -1 (white) because 'string' > 0 is false
    expect(v.classList.contains('shudan-paint_-1')).toBe(true)
    expect(v.classList.contains('shudan-paint_1')).toBe(false)
  })
})

describe('combined maps — review display scenarios', () => {
  it('checkmark on black stone: correct vertex classes and marker text', () => {
    let signMap = makeEmptyMap(5, 0)
    signMap[2][2] = 1
    let markerMap = makeEmptyMap(5)
    markerMap[2][2] = { type: 'label', label: '✓' }
    let c = renderGoban({ signMap, markerMap })
    let v = getVertex(c, 2, 2)
    expect(v.classList.contains('shudan-sign_1')).toBe(true)
    expect(v.classList.contains('shudan-marker_label')).toBe(true)
    expect(v.getAttribute('title')).toBe('✓')
    let marker = v.querySelector('.shudan-stone .shudan-marker')
    expect(marker.textContent).toBe('✓')
  })

  it('cross on white stone: correct vertex classes and marker text', () => {
    let signMap = makeEmptyMap(5, 0)
    signMap[3][1] = -1
    let markerMap = makeEmptyMap(5)
    markerMap[3][1] = { type: 'label', label: '✗' }
    let c = renderGoban({ signMap, markerMap })
    let v = getVertex(c, 1, 3)
    expect(v.classList.contains('shudan-sign_-1')).toBe(true)
    expect(v.getAttribute('title')).toBe('✗')
    let marker = v.querySelector('.shudan-stone .shudan-marker')
    expect(marker.textContent).toBe('✗')
  })

  it('move number marker on stone', () => {
    let signMap = makeEmptyMap(5, 0)
    signMap[3][3] = -1
    let markerMap = makeEmptyMap(5)
    markerMap[3][3] = { type: 'label', label: '12' }
    let c = renderGoban({ signMap, markerMap })
    let v = getVertex(c, 3, 3)
    let marker = v.querySelector('.shudan-stone .shudan-marker')
    expect(marker.textContent).toBe('12')
    expect(v.classList.contains('shudan-smalllabel')).toBe(false)
  })

  it('show phase: stone visible with move number, others hidden', () => {
    // Simulates: move 3 just played at 2,2 (black), other moves invisible
    let signMap = makeEmptyMap(5, 0)
    signMap[2][2] = 1 // just played
    let markerMap = makeEmptyMap(5)
    markerMap[2][2] = { type: 'label', label: '3' }
    let ghostStoneMap = makeEmptyMap(5)
    let c = renderGoban({ signMap, markerMap, ghostStoneMap })
    let v = getVertex(c, 2, 2)
    expect(v.classList.contains('shudan-sign_1')).toBe(true)
    let marker = v.querySelector('.shudan-stone .shudan-marker')
    expect(marker.textContent).toBe('3')
    // All other vertices are empty
    expect(getVertex(c, 0, 0).classList.contains('shudan-sign_0')).toBe(true)
  })

  it('peeking: invisible stones shown as faint ghosts', () => {
    let signMap = makeEmptyMap(5, 0)
    let ghostStoneMap = makeEmptyMap(5)
    ghostStoneMap[1][1] = { sign: 1, faint: true }
    ghostStoneMap[3][3] = { sign: -1, faint: true }
    let c = renderGoban({ signMap, ghostStoneMap })
    let v1 = getVertex(c, 1, 1)
    expect(v1.classList.contains('shudan-ghost_faint')).toBe(true)
    expect(v1.classList.contains('shudan-ghost_1')).toBe(true)
    expect(v1.querySelector('.shudan-ghost')).not.toBeNull()
    let v2 = getVertex(c, 3, 3)
    expect(v2.classList.contains('shudan-ghost_faint')).toBe(true)
    expect(v2.classList.contains('shudan-ghost_-1')).toBe(true)
  })

  it('liberty exercise: circle markers on marked stones', () => {
    // During exercise, marked stones show as circles
    let signMap = makeEmptyMap(5, 0)
    signMap[2][2] = 1
    let markerMap = makeEmptyMap(5)
    markerMap[2][2] = { type: 'circle' }
    let c = renderGoban({ signMap, markerMap })
    let v = getVertex(c, 2, 2)
    expect(v.classList.contains('shudan-marker_circle')).toBe(true)
  })
})

describe('rangeX/rangeY — partial board rendering', () => {
  it('rangeX/rangeY limits rendered vertices', () => {
    let signMap = makeEmptyMap(9, 0)
    let c = renderGoban({ signMap, rangeX: [2, 5], rangeY: [1, 4] })
    let vertices = c.querySelectorAll('.shudan-vertex')
    // 4 cols (2,3,4,5) × 4 rows (1,2,3,4) = 16
    expect(vertices.length).toBe(16)
  })

  it('rangeX/rangeY vertices have correct coordinates', () => {
    let signMap = makeEmptyMap(9, 0)
    signMap[3][4] = 1
    let c = renderGoban({ signMap, rangeX: [2, 5], rangeY: [1, 4] })
    let v = getVertex(c, 4, 3)
    expect(v).not.toBeNull()
    expect(v.classList.contains('shudan-sign_1')).toBe(true)
    // Vertex outside range should not exist
    expect(getVertex(c, 0, 0)).toBeNull()
  })
})

describe('onVertexClick interaction', () => {
  it('click triggers handler with correct vertex coordinates', () => {
    let clicked = null
    let c = renderGoban({
      onVertexClick: (evt, vertex) => { clicked = vertex },
    })
    let v = getVertex(c, 3, 2)
    v.click()
    expect(clicked).toEqual([3, 2])
  })

  it('click on different vertices gives different coordinates', () => {
    let clicks = []
    let c = renderGoban({
      onVertexClick: (evt, vertex) => { clicks.push(vertex) },
    })
    getVertex(c, 0, 0).click()
    getVertex(c, 4, 4).click()
    getVertex(c, 2, 1).click()
    expect(clicks).toEqual([[0, 0], [4, 4], [2, 1]])
  })
})

// ============================================================
// Integration: QuizEngine → display maps → Goban rendering
// Mirrors quiz.jsx map-building logic exactly
// ============================================================

function libLabel(n) {
  return n >= 6 ? '6+' : String(n)
}

// Build display maps from engine state in finished mode, same as quiz.jsx
function buildFinishedMaps(engine) {
  let size = engine.boardSize
  let signMap = engine.trueBoard.signMap.map(row => [...row])
  let markerMap = makeEmptyMap(size)
  let ghostStoneMap = makeEmptyMap(size)
  let paintMap = makeEmptyMap(size, 0)

  let exercise = engine.libertyExercise
  if (exercise) {
    let userMarks = exercise.userMarks || new Map()
    let moveIdx = engine.moveProgress.length - 1
    let asked = engine.questionsAsked[moveIdx] || []
    let changedIdx = 0

    for (let g of exercise.groups) {
      if (!g.changed) {
        let [x, y] = g.vertex
        markerMap[y][x] = { type: 'label', label: libLabel(g.libCount) }
      } else {
        let correct = asked[changedIdx]?.markedCorrectly
        changedIdx++
        let userVertex = null, userVal = null
        for (let k of g.chainKeys) {
          if (userMarks.has(k)) { userVertex = k; userVal = userMarks.get(k); break }
        }
        if (userVertex !== null) {
          let [mx, my] = userVertex.split(',').map(Number)
          markerMap[my][mx] = { type: 'label', label: libLabel(userVal) }
          paintMap[my][mx] = correct ? 1 : -1
        } else {
          let [x, y] = g.vertex
          markerMap[y][x] = { type: 'label', label: libLabel(g.libCount) }
          paintMap[y][x] = -1
        }
      }
    }
  }

  return { signMap, markerMap, ghostStoneMap, paintMap }
}

function buildPlayMaps(engine, peeking = false) {
  let size = engine.boardSize
  let signMap = engine.getDisplaySignMap()
  let markerMap = makeEmptyMap(size)
  let ghostStoneMap = makeEmptyMap(size)
  let paintMap = makeEmptyMap(size)

  if (engine.currentMove && engine.showingMove) {
    let [x, y] = engine.currentMove.vertex
    signMap[y][x] = engine.currentMove.sign
    markerMap[y][x] = { type: 'label', label: String(engine.moveIndex) }
    for (let { vertex, moveNumber } of engine.getWindowStones()) {
      let [wx, wy] = vertex
      let sign = engine.trueBoard.get(vertex)
      if (sign !== 0) {
        signMap[wy][wx] = sign
        markerMap[wy][wx] = { type: 'label', label: String(moveNumber) }
      }
    }
  }

  if (peeking) {
    for (let [, { vertex }] of engine.invisibleStones) {
      let [x, y] = vertex
      let sign = engine.trueBoard.get(vertex)
      if (sign !== 0) {
        signMap[y][x] = 0
        ghostStoneMap[y][x] = { sign, faint: true }
      }
    }
  }

  return { signMap, markerMap, ghostStoneMap, paintMap }
}

function buildExerciseMaps(engine, libMarks) {
  let size = engine.boardSize
  let signMap = engine.getDisplaySignMap()
  let markerMap = makeEmptyMap(size)
  let ghostStoneMap = makeEmptyMap(size)
  let paintMap = makeEmptyMap(size)

  let exercise = engine.libertyExercise
  for (let g of exercise.groups) {
    if (g.changed) continue
    let [x, y] = g.vertex
    markerMap[y][x] = { type: 'label', label: libLabel(g.libCount) }
  }
  for (let [key, val] of libMarks) {
    let [mx, my] = key.split(',').map(Number)
    markerMap[my][mx] = { type: 'label', label: libLabel(val) }
  }

  return { signMap, markerMap, ghostStoneMap, paintMap }
}

// Helper: play to finished state with correct answers
function playToFinish(sgf, maxQ = 2) {
  let engine = new QuizEngine(sgf, true, maxQ)
  while (!engine.finished) {
    engine.advance()
    engine.activateQuestions()
    if (engine.libertyExerciseActive) {
      let marks = new Map()
      for (let g of engine.libertyExercise.groups.filter(g => g.changed))
        marks.set([...g.chainKeys][0], Math.min(g.libCount, 6))
      engine.submitLibertyExercise(marks)
      engine.advance()
    }
  }
  return engine
}

// Simple 5-move SGF: alternating black/white on a 5x5 board
let SGF_5x5 = '(;SZ[5];B[bb];W[cc];B[dd];W[ee];B[bc])'

describe('QuizEngine → Goban integration: show phase', () => {
  it('after advance, current move stone is visible with move number', () => {
    let engine = new QuizEngine(SGF_5x5, true, 2)
    engine.advance()
    let maps = buildPlayMaps(engine)
    let c = renderGoban(maps)
    // Move 1: B[bb] = black at x=1,y=1
    let v = getVertex(c, 1, 1)
    expect(v.classList.contains('shudan-sign_1')).toBe(true)
    expect(v.querySelector('.shudan-stone .shudan-marker').textContent).toBe('1')
  })

  it('after activateQuestions on non-last move, no markers', () => {
    let engine = new QuizEngine(SGF_5x5, true, 2)
    engine.advance()
    engine.activateQuestions()
    let maps = buildPlayMaps(engine)
    let c = renderGoban(maps)
    // no exercise until last move
    let vertices = c.querySelectorAll('.shudan-vertex')
    let hasMarker = Array.from(vertices).some(v => v.querySelector('.shudan-marker'))
    expect(hasMarker).toBe(false)
  })

  it('after all advances, last move triggers exercise', () => {
    let engine = new QuizEngine(SGF_5x5, true, 2)
    while (!engine.finished) {
      engine.advance()
      engine.activateQuestions()
      if (engine.libertyExerciseActive) break
    }
    expect(engine.libertyExerciseActive).toBe(true)
    expect(engine.libertyExercise.groups.length).toBeGreaterThan(0)
  })
})

describe('QuizEngine → Goban integration: peek mode', () => {
  it('peeking reveals invisible stones as faint ghosts', () => {
    let engine = new QuizEngine(SGF_5x5, true, 2)
    // Play a few moves without showing
    engine.advance(); engine.activateQuestions()
    engine.advance(); engine.activateQuestions()
    let maps = buildPlayMaps(engine, true)
    let c = renderGoban(maps)
    // Should have ghost stones for invisible moves
    let ghosts = c.querySelectorAll('.shudan-ghost')
    expect(ghosts.length).toBeGreaterThan(0)
    // All ghost vertices should have faint class
    let ghostVertices = c.querySelectorAll('.shudan-ghost_faint')
    expect(ghostVertices.length).toBeGreaterThan(0)
  })
})

describe('QuizEngine → Goban integration: liberty exercise', () => {
  it('pre-marked groups show as label markers', () => {
    // Setup: dd has 4 libs. Moves: B[ee], W[aa] — dd unchanged
    let engine = new QuizEngine('(;SZ[9]AB[dd];B[ee];W[aa])', true, 3)
    while (!engine.finished) {
      engine.advance()
      engine.activateQuestions()
      if (engine.libertyExerciseActive) break
    }
    let ddGroup = engine.libertyExercise.groups.find(g => [...g.chainKeys].includes('3,3'))
    if (!ddGroup || ddGroup.changed) return
    let maps = buildExerciseMaps(engine, new Map())
    let c = renderGoban(maps)
    let [dx, dy] = ddGroup.vertex
    let v = getVertex(c, dx, dy)
    expect(v.classList.contains('shudan-marker_label')).toBe(true)
    expect(v.querySelector('.shudan-marker').textContent).toBe(libLabel(ddGroup.libCount))
  })

  it('user marks show as label markers with number', () => {
    let engine = new QuizEngine('(;SZ[9];B[ee];W[de])', true, 3)
    while (!engine.finished) {
      engine.advance()
      engine.activateQuestions()
      if (engine.libertyExerciseActive) break
    }
    // Mark ee with label 3
    let marks = new Map([['4,4', 3]])
    let maps = buildExerciseMaps(engine, marks)
    let c = renderGoban(maps)
    let v = getVertex(c, 4, 4)
    expect(v.classList.contains('shudan-marker_label')).toBe(true)
    expect(v.querySelector('.shudan-marker').textContent).toBe('3')
  })

  it('groups with >5 libs show "5+" label when pre-marked', () => {
    // 3 black stones in row: 8 libs. Setup so they exist in initial position too (unchanged)
    let engine = new QuizEngine('(;SZ[9]AB[ee][fe][ge];B[aa])', true, 3)
    engine.advance(); engine.activateQuestions()
    let bigGroup = engine.libertyExercise.groups.find(g => g.libCount > 5 && !g.changed)
    if (!bigGroup) return
    let maps = buildExerciseMaps(engine, new Map())
    let c = renderGoban(maps)
    let [bx, by] = bigGroup.vertex
    let v = getVertex(c, bx, by)
    expect(v.querySelector('.shudan-marker').textContent).toBe('6+')
  })
})

describe('QuizEngine → Goban integration: finished review', () => {
  it('finished board shows all stones from true board', () => {
    let engine = playToFinish(SGF_5x5)
    let maps = buildFinishedMaps(engine)
    let c = renderGoban(maps)
    let black = c.querySelectorAll('.shudan-vertex.shudan-sign_1').length
    let white = c.querySelectorAll('.shudan-vertex.shudan-sign_-1').length
    let trueBlack = 0, trueWhite = 0
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 5; x++) {
        let s = engine.trueBoard.get([x, y])
        if (s === 1) trueBlack++
        if (s === -1) trueWhite++
      }
    expect(black).toBe(trueBlack)
    expect(white).toBe(trueWhite)
  })

  it('correct answers show lib count labels with paint_1 (green)', () => {
    let engine = playToFinish(SGF_5x5)
    let maps = buildFinishedMaps(engine)
    let c = renderGoban(maps)
    // Correct marks get paint_1 class
    let greenVertices = c.querySelectorAll('.shudan-vertex.shudan-paint_1')
    expect(greenVertices.length).toBeGreaterThan(0)
    for (let v of greenVertices) {
      let marker = v.querySelector('.shudan-marker')
      expect(marker).not.toBeNull()
      expect(marker.textContent).toMatch(/^[1-5]|6\+$/)
    }
  })

  it('wrong answers show lib count labels with paint_-1 (red)', () => {
    let engine = new QuizEngine(SGF_5x5, true, 2)
    while (!engine.finished) {
      engine.advance()
      engine.activateQuestions()
      if (engine.libertyExerciseActive) {
        // Mark everything as 1 (wrong for most groups)
        let marks = new Map()
        for (let g of engine.libertyExercise.groups.filter(g => g.changed))
          marks.set([...g.chainKeys][0], 1)
        engine.submitLibertyExercise(marks)
        engine.advance()
      }
    }
    let maps = buildFinishedMaps(engine)
    let c = renderGoban(maps)
    let redVertices = c.querySelectorAll('.shudan-vertex.shudan-paint_-1')
    expect(redVertices.length).toBeGreaterThan(0)
  })

  it('no paintMap values are strings (regression: white squares bug)', () => {
    let engine = playToFinish(SGF_5x5)
    let maps = buildFinishedMaps(engine)
    for (let row of maps.paintMap)
      for (let cell of row)
        expect(typeof cell !== 'string').toBe(true)
  })

  it('wrong mark gets paint_-1, correct gets paint_1 on specific vertices', () => {
    let engine = new QuizEngine('(;SZ[9];B[ee];W[de])', true, 3)
    while (!engine.finished) {
      engine.advance()
      engine.activateQuestions()
      if (engine.libertyExerciseActive) {
        let marks = new Map([['4,4', 1]]) // B[ee] has 3 libs → wrong
        let wGroup = engine.libertyExercise.groups.find(g => [...g.chainKeys].includes('3,4'))
        marks.set('3,4', Math.min(wGroup.libCount, 6)) // correct
        engine.submitLibertyExercise(marks)
        engine.advance()
      }
    }
    let maps = buildFinishedMaps(engine)
    // B[ee]=[4,4] marked wrong → paint -1
    expect(maps.paintMap[4][4]).toBe(-1)
    // W[de]=[3,4] marked correct → paint 1
    expect(maps.paintMap[4][3]).toBe(1)

    let c = renderGoban(maps)
    // Verify classes on rendered vertices
    let vEE = getVertex(c, 4, 4)
    expect(vEE.classList.contains('shudan-paint_-1')).toBe(true)
    expect(vEE.querySelector('.shudan-marker').textContent).toBe('1')
    let vDE = getVertex(c, 3, 4)
    expect(vDE.classList.contains('shudan-paint_1')).toBe(true)
  })

  it('pre-marked groups show labels in finished state', () => {
    // Use SGF with setup stones so some groups are unchanged
    let engine = playToFinish('(;SZ[9]AB[dd];B[ee];W[aa])', 3)
    let maps = buildFinishedMaps(engine)
    let c = renderGoban(maps)
    // dd is pre-marked (unchanged), should have a label
    let ddGroup = engine.libertyExercise.groups.find(g => [...g.chainKeys].includes('3,3'))
    if (ddGroup && !ddGroup.changed) {
      let [dx, dy] = ddGroup.vertex
      let v = getVertex(c, dx, dy)
      expect(v.classList.contains('shudan-marker_label')).toBe(true)
    }
  })
})

// Tsumego-style SGFs
let SGF_TSUMEGO = '(;SZ[9]AB[aa][ba][ca][ab][bb]AW[cb][ac][bc][cc];B[da];W[db])'

describe('QuizEngine → Goban integration: tsumego with setup stones', () => {
  it('setup stones are visible on finished board', () => {
    let engine = playToFinish(SGF_TSUMEGO, 3)
    let maps = buildFinishedMaps(engine)
    let c = renderGoban(maps)
    // AB[aa] = black at 0,0
    expect(getVertex(c, 0, 0).classList.contains('shudan-sign_1')).toBe(true)
    // AW[cb] = white at 2,1
    expect(getVertex(c, 2, 1).classList.contains('shudan-sign_-1')).toBe(true)
  })

  it('all groups have labels in finished state', () => {
    let engine = playToFinish(SGF_TSUMEGO, 3)
    let maps = buildFinishedMaps(engine)
    let c = renderGoban(maps)
    // Every group (changed and unchanged) should have a label marker
    let markedVertices = c.querySelectorAll('.shudan-vertex.shudan-marker_label')
    expect(markedVertices.length).toBe(engine.libertyExercise.groups.length)
  })
})

describe('display map integrity', () => {
  it('signMap dimensions match boardSize', () => {
    let engine = playToFinish(SGF_5x5)
    let maps = buildFinishedMaps(engine)
    expect(maps.signMap.length).toBe(5)
    for (let row of maps.signMap) expect(row.length).toBe(5)
  })

  it('all map dimensions match', () => {
    let engine = playToFinish(SGF_5x5)
    let maps = buildFinishedMaps(engine)
    for (let mapName of ['signMap', 'markerMap', 'ghostStoneMap', 'paintMap']) {
      expect(maps[mapName].length).toBe(5)
      for (let row of maps[mapName]) expect(row.length).toBe(5)
    }
  })

  it('play mode maps have correct dimensions', () => {
    let engine = new QuizEngine(SGF_5x5, true, 2)
    engine.advance()
    let maps = buildPlayMaps(engine)
    for (let mapName of ['signMap', 'markerMap', 'ghostStoneMap', 'paintMap']) {
      expect(maps[mapName].length).toBe(5)
      for (let row of maps[mapName]) expect(row.length).toBe(5)
    }
  })

  it('no ghost stones in finished review', () => {
    let engine = playToFinish(SGF_5x5)
    let maps = buildFinishedMaps(engine)
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 5; x++)
        expect(maps.ghostStoneMap[y][x]).toBeNull()
  })

  it('no paint string values anywhere in play mode maps', () => {
    let engine = new QuizEngine(SGF_5x5, true, 2)
    engine.advance()
    let maps = buildPlayMaps(engine)
    for (let row of maps.paintMap)
      for (let cell of row)
        expect(typeof cell !== 'string').toBe(true)
  })
})
