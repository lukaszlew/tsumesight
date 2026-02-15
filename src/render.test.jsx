// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest'
import { render } from '@testing-library/preact'
import { Goban } from '@sabaki/shudan'

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

  it('question marker renders ❓ text', () => {
    let markerMap = makeEmptyMap(5)
    markerMap[0][4] = { type: 'label', label: '❓' }
    let signMap = makeEmptyMap(5, 0)
    signMap[0][4] = 1
    let c = renderGoban({ signMap, markerMap })
    let marker = getVertex(c, 4, 0).querySelector('.shudan-marker')
    expect(marker.textContent).toBe('❓')
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

  it('liberty display: ghost stones on empty vertices around a stone', () => {
    // Black stone at 2,2; liberties at 1,2 2,1 3,2 2,3
    let signMap = makeEmptyMap(5, 0)
    signMap[2][2] = 1
    let markerMap = makeEmptyMap(5)
    markerMap[2][2] = { type: 'label', label: '✓' }
    let ghostStoneMap = makeEmptyMap(5)
    // True liberties shown as "good" ghost stones
    ghostStoneMap[2][1] = { sign: 1, type: 'good' }
    ghostStoneMap[1][2] = { sign: 1, type: 'good' }
    ghostStoneMap[2][3] = { sign: 1, type: 'good' }
    ghostStoneMap[3][2] = { sign: 1, type: 'good' }
    let c = renderGoban({ signMap, markerMap, ghostStoneMap })

    // Check liberties have ghost divs
    for (let [x, y] of [[1,2],[2,1],[3,2],[2,3]]) {
      let v = getVertex(c, x, y)
      expect(v.classList.contains('shudan-ghost_good')).toBe(true)
      expect(v.querySelector('.shudan-ghost')).not.toBeNull()
    }
    // Stone vertex has no ghost div
    expect(getVertex(c, 2, 2).querySelector('.shudan-ghost')).toBeNull()
  })

  it('wrong marks: bad ghost stones on empty non-liberty vertices', () => {
    let signMap = makeEmptyMap(5, 0)
    signMap[2][2] = 1
    let ghostStoneMap = makeEmptyMap(5)
    // Wrong mark at 0,0 (not adjacent)
    ghostStoneMap[0][0] = { sign: -1, type: 'bad' }
    let c = renderGoban({ signMap, ghostStoneMap })
    let v = getVertex(c, 0, 0)
    expect(v.classList.contains('shudan-ghost_bad')).toBe(true)
    expect(v.querySelector('.shudan-ghost')).not.toBeNull()
  })

  it('question mark during play: marker on stone', () => {
    let signMap = makeEmptyMap(5, 0)
    signMap[2][2] = 1
    let markerMap = makeEmptyMap(5)
    markerMap[2][2] = { type: 'label', label: '❓' }
    let c = renderGoban({ signMap, markerMap })
    let v = getVertex(c, 2, 2)
    expect(v.getAttribute('title')).toBe('❓')
    let marker = v.querySelector('.shudan-stone .shudan-marker')
    expect(marker.textContent).toBe('❓')
  })

  it('marked liberties during play: interesting ghost stones', () => {
    let signMap = makeEmptyMap(5, 0)
    signMap[2][2] = 1
    let markerMap = makeEmptyMap(5)
    markerMap[2][2] = { type: 'label', label: '❓' }
    let ghostStoneMap = makeEmptyMap(5)
    // User marked liberties shown as "interesting" (blue)
    ghostStoneMap[2][1] = { sign: 1, type: 'interesting' }
    ghostStoneMap[1][2] = { sign: 1, type: 'interesting' }
    let c = renderGoban({ signMap, markerMap, ghostStoneMap })
    expect(getVertex(c, 1, 2).classList.contains('shudan-ghost_interesting')).toBe(true)
    expect(getVertex(c, 2, 1).classList.contains('shudan-ghost_interesting')).toBe(true)
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

  it('full review scenario: multiple ✓/✗ with liberty display on one', () => {
    let signMap = makeEmptyMap(9, 0)
    let markerMap = makeEmptyMap(9)
    let ghostStoneMap = makeEmptyMap(9)

    // Two black groups, one white group
    signMap[2][2] = 1
    signMap[2][3] = 1
    signMap[5][5] = -1
    // Group 1 answered correctly
    markerMap[2][2] = { type: 'label', label: '✓' }
    // Group 2 answered wrong
    markerMap[5][5] = { type: 'label', label: '✗' }

    // Show liberties for group 2 (clicked)
    // True liberties of white stone at 5,5: 4,5 6,5 5,4 5,6
    ghostStoneMap[5][4] = { sign: 1, type: 'good' }
    ghostStoneMap[5][6] = { sign: 1, type: 'good' }
    ghostStoneMap[4][5] = { sign: 1, type: 'good' }
    ghostStoneMap[6][5] = { sign: 1, type: 'good' }
    // User wrong mark at 3,3
    ghostStoneMap[3][3] = { sign: -1, type: 'bad' }

    let c = renderGoban({ signMap, markerMap, ghostStoneMap })

    // Correct group marker
    let g1 = getVertex(c, 2, 2)
    expect(g1.getAttribute('title')).toBe('✓')
    expect(g1.querySelector('.shudan-stone .shudan-marker').textContent).toBe('✓')

    // Wrong group marker
    let g2 = getVertex(c, 5, 5)
    expect(g2.getAttribute('title')).toBe('✗')
    expect(g2.querySelector('.shudan-stone .shudan-marker').textContent).toBe('✗')

    // True liberties are green ghosts
    for (let [x, y] of [[4,5],[6,5],[5,4],[5,6]]) {
      let v = getVertex(c, x, y)
      expect(v.classList.contains('shudan-ghost_good')).toBe(true)
    }

    // Wrong mark is red ghost
    let wrong = getVertex(c, 3, 3)
    expect(wrong.classList.contains('shudan-ghost_bad')).toBe(true)

    // Non-involved vertices have no ghosts
    let empty = getVertex(c, 0, 0)
    expect(empty.querySelector('.shudan-ghost')).toBeNull()
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
