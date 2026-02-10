import sgf from '@sabaki/sgf'

// Depth of the longest path from this node (counting nodes with moves)
function longestDepth(node) {
  if (!node.children || node.children.length === 0) return 0
  let best = 0
  for (let child of node.children) {
    let d = longestDepth(child) + (child.data.B || child.data.W ? 1 : 0)
    if (d > best) best = d
  }
  return best
}

// Walk the longest variation through the tree
function walkMainLine(node) {
  let nodes = [node]
  while (node.children && node.children.length > 0) {
    let best = node.children[0], bestDepth = longestDepth(best)
    for (let i = 1; i < node.children.length; i++) {
      let d = longestDepth(node.children[i])
      if (d > bestDepth) { best = node.children[i]; bestDepth = d }
    }
    node = best
    nodes.push(node)
  }
  return nodes
}

export function parseSgf(sgfString) {
  let trees = sgf.parse(sgfString)
  assert(trees.length > 0, 'SGF contains no game trees')
  let root = trees[0]

  let boardSize = root.data.SZ ? parseInt(root.data.SZ[0]) : 19

  // Setup stones from root node
  let setupBlack = []
  let setupWhite = []
  if (root.data.AB) {
    for (let v of root.data.AB) {
      for (let vertex of sgf.parseCompressedVertices(v)) {
        setupBlack.push(vertex)
      }
    }
  }
  if (root.data.AW) {
    for (let v of root.data.AW) {
      for (let vertex of sgf.parseCompressedVertices(v)) {
        setupWhite.push(vertex)
      }
    }
  }

  // Player names and game name
  let playerBlack = root.data.PB ? root.data.PB[0] : ''
  let playerWhite = root.data.PW ? root.data.PW[0] : ''
  let gameName = root.data.GN ? root.data.GN[0] : ''

  // Extract moves from main line (skip root node)
  let nodes = walkMainLine(root)
  let moves = []
  for (let i = 1; i < nodes.length; i++) {
    let node = nodes[i]
    if (node.data.B != null) {
      let raw = node.data.B[0]
      // Pass: empty string or 'tt' on 19x19
      if (!raw || raw === 'tt') {
        moves.push({ sign: 1, vertex: null })
      } else {
        moves.push({ sign: 1, vertex: sgf.parseVertex(raw) })
      }
    } else if (node.data.W != null) {
      let raw = node.data.W[0]
      if (!raw || raw === 'tt') {
        moves.push({ sign: -1, vertex: null })
      } else {
        moves.push({ sign: -1, vertex: sgf.parseVertex(raw) })
      }
    }
  }

  return {
    boardSize,
    moves,
    setupBlack,
    setupWhite,
    playerBlack,
    playerWhite,
    gameName,
    moveCount: moves.length,
  }
}

// Walk entire tree collecting all stone coordinates (setup + moves in all variations)
function collectAllVertices(node) {
  let vertices = []
  if (node.data.AB) {
    for (let v of node.data.AB)
      for (let vertex of sgf.parseCompressedVertices(v)) vertices.push(vertex)
  }
  if (node.data.AW) {
    for (let v of node.data.AW)
      for (let vertex of sgf.parseCompressedVertices(v)) vertices.push(vertex)
  }
  if (node.data.B && node.data.B[0] && node.data.B[0] !== 'tt')
    vertices.push(sgf.parseVertex(node.data.B[0]))
  if (node.data.W && node.data.W[0] && node.data.W[0] !== 'tt')
    vertices.push(sgf.parseVertex(node.data.W[0]))
  if (node.children) {
    for (let child of node.children) vertices.push(...collectAllVertices(child))
  }
  return vertices
}

// For problems (have setup stones): compute bounding box of all stones + 1 margin
// Returns [minX, minY, maxX, maxY] or null for full games
export function computeRange(sgfString) {
  let trees = sgf.parse(sgfString)
  let root = trees[0]
  if (!root.data.AB && !root.data.AW) return null

  let size = root.data.SZ ? parseInt(root.data.SZ[0]) : 19
  let vertices = collectAllVertices(root)
  if (vertices.length === 0) return null

  let minX = size, maxX = 0, minY = size, maxY = 0
  for (let [x, y] of vertices) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }

  // Add 1 margin, clamped to board
  minX = Math.max(0, minX - 1)
  maxX = Math.min(size - 1, maxX + 1)
  minY = Math.max(0, minY - 1)
  maxY = Math.min(size - 1, maxY + 1)

  // If range covers nearly the full board, just show full
  if (maxX - minX >= size - 2 && maxY - minY >= size - 2) return null

  return [minX, minY, maxX, maxY]
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}
