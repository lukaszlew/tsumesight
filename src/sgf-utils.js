import sgf from '@sabaki/sgf'

// Decode SGF bytes using encoding declared in CA property, defaulting to UTF-8.
// Falls back to CJK encodings when UTF-8 produces replacement chars (U+FFFD),
// which indicates multi-byte chars whose second bytes could corrupt SGF delimiters.
export function decodeSgf(bytes) {
  let encoding = detectCaEncoding(bytes)
  if (encoding && encoding !== 'utf-8') {
    try { return new TextDecoder(encoding).decode(bytes) } catch {}
  }
  let utf8 = new TextDecoder('utf-8').decode(bytes)
  if (!utf8.includes('\uFFFD')) return utf8
  // Safe encodings first: second bytes always >= 0xA1, never consume [ or ]
  for (let enc of ['euc-jp', 'euc-kr']) {
    let decoded = new TextDecoder(enc).decode(bytes)
    if (!decoded.includes('\uFFFD')) return decoded
  }
  // Dangerous encodings: second bytes can be 0x5B/0x5D ([/]), verify parse works
  for (let enc of ['gbk', 'big5', 'shift_jis']) {
    let decoded = new TextDecoder(enc).decode(bytes)
    if (decoded.includes('\uFFFD')) continue
    try { parseSgf(decoded); return decoded } catch {}
  }
  return utf8
}

// Scan raw bytes for CA[encoding] property
// Works at byte level to avoid multi-byte encoding issues (GBK second bytes can be 0x5D=']')
function detectCaEncoding(bytes) {
  let limit = Math.min(bytes.length, 500)
  for (let i = 0; i < limit - 4; i++) {
    if (bytes[i] !== 0x43 || bytes[i + 1] !== 0x41 || bytes[i + 2] !== 0x5B) continue // CA[
    let start = i + 3
    let end = start
    while (end < limit && bytes[end] !== 0x5D) end++ // find ]
    if (end >= limit) return null
    let value = ''
    for (let j = start; j < end; j++) value += String.fromCharCode(bytes[j])
    value = value.trim().toLowerCase()
    let map = {
      'utf-8': 'utf-8', 'utf8': 'utf-8',
      'gb2312': 'gbk', 'gbk': 'gbk', 'gb18030': 'gb18030',
      'big5': 'big5',
      'euc-kr': 'euc-kr', 'euc_kr': 'euc-kr',
      'shift_jis': 'shift_jis', 'sjis': 'shift_jis',
      'iso-8859-1': 'iso-8859-1', 'latin1': 'iso-8859-1', 'latin-1': 'iso-8859-1',
      'windows-1252': 'windows-1252',
    }
    return map[value] || value
  }
  return null
}

// Total move count from this node (inclusive) down through longest variation
function moveDepth(node) {
  let self = (node.data.B || node.data.W) ? 1 : 0
  if (!node.children || node.children.length === 0) return self
  let best = 0
  for (let child of node.children) {
    let d = moveDepth(child)
    if (d > best) best = d
  }
  return self + best
}

// Pick the main-line child at a branch point:
// 1. Exclude WV (Wrong Variation) children
// 2. If first candidate has no move (comment-only), skip it
// 3. Prefer first remaining candidate; fall back to longest
function pickChild(children) {
  let candidates = children.filter(c => !('WV' in c.data))
  if (candidates.length === 0) candidates = children
  if (candidates[0].data.B || candidates[0].data.W) return candidates[0]
  let withMoves = candidates.filter(c => c.data.B || c.data.W)
  if (withMoves.length > 0) return withMoves[0]
  return longestOf(candidates)
}

function longestOf(nodes) {
  let best = nodes[0], bestScore = moveDepth(best)
  for (let i = 1; i < nodes.length; i++) {
    let d = moveDepth(nodes[i])
    if (d > bestScore) { best = nodes[i]; bestScore = d }
  }
  return best
}

// Walk the main line through the tree
function walkMainLine(node) {
  let nodes = [node]
  while (node.children && node.children.length > 0) {
    node = node.children.length === 1 ? node.children[0] : pickChild(node.children)
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
      moves.push({ sign: 1, vertex: parseMove(node.data.B[0], boardSize) })
    } else if (node.data.W != null) {
      moves.push({ sign: -1, vertex: parseMove(node.data.W[0], boardSize) })
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

// Parse move coordinate; treat empty, 'tt', and out-of-bounds as pass (null)
function parseMove(raw, boardSize) {
  if (!raw || raw === 'tt') return null
  let vertex = sgf.parseVertex(raw)
  if (vertex[0] < 0 || vertex[0] >= boardSize || vertex[1] < 0 || vertex[1] >= boardSize) return null
  return vertex
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}
