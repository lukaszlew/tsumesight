import sgf from '@sabaki/sgf'

// Walk main line: root → children[0] → children[0] → ...
function walkMainLine(node) {
  let nodes = [node]
  while (node.children && node.children.length > 0) {
    // Prefer children[0], but if it has no move, find one that does
    // (some tsumego SGFs put a comment-only node as children[0])
    let next = node.children[0]
    if (!next.data.B && !next.data.W) {
      let moveChild = node.children.find(c => c.data.B || c.data.W)
      if (moveChild) next = moveChild
    }
    node = next
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

  // Player names
  let playerBlack = root.data.PB ? root.data.PB[0] : ''
  let playerWhite = root.data.PW ? root.data.PW[0] : ''

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
    moveCount: moves.length,
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}
