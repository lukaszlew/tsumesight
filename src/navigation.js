// Pure navigation helpers. Consumed by app.jsx and library.jsx so the
// "next unsolved" logic has exactly one home.
//
// scoreLookup is a function of (sgfId) → { bestAccuracy, latestDate }
// where bestAccuracy is null if no score exists, latestDate is 0 if
// none. Keeps the helpers testable without touching db.

// The selection payload onSelect handlers expect. Normalizes `path` and
// `solved` from whatever the source record provides.
export function toSelection(s) {
  return { id: s.id, content: s.content, path: s.path || '', filename: s.filename, solved: !!s.solved }
}

// SGFs at the given cwd, sorted by upload date then filename.
export function siblings(sgfs, cwd) {
  let path = cwd || ''
  return sgfs
    .filter(s => (s.path || '') === path)
    .sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0) || a.filename.localeCompare(b.filename))
}

// Cyclic neighbour: delta=+1/−1 picks the next/prev sibling.
// currentId may be null (returns first sibling on +1).
// Returns the sibling or null if the list is empty.
export function stepSibling(list, currentId, delta) {
  if (list.length === 0) return null
  let idx = list.findIndex(s => s.id === currentId)
  if (idx === -1) return list[0]
  return list[(idx + delta + list.length) % list.length]
}

// Returns { sgf, reason } or null.
//   reason: 'unsolved'      — first unsolved sibling (cycling from currentId)
//           'imperfect'     — all solved, pick first with best-accuracy < 1
//           'least-recent'  — all perfect, least recently practiced
// Problems with moveCount === 0 are skipped (they have no exercise).
// currentId may be null: cycle starts from index 0.
export function nextUnsolved(list, currentId, scoreLookup) {
  let pickable = list.filter(s => (s.moveCount || 0) > 0)
  if (pickable.length === 0) return null
  let curIdx = pickable.findIndex(s => s.id === currentId)
  let startOffset = curIdx === -1 ? 0 : 1

  // Cyclic iteration starting right after currentId (or from 0 if not found).
  let order = []
  for (let i = 0; i < pickable.length; i++) {
    order.push(pickable[((curIdx === -1 ? 0 : curIdx) + startOffset + i) % pickable.length])
  }

  for (let s of order) {
    if (!s.solved) return { sgf: s, reason: 'unsolved' }
  }
  for (let s of order) {
    let { bestAccuracy } = scoreLookup(s.id)
    if (bestAccuracy == null || bestAccuracy < 1) return { sgf: s, reason: 'imperfect' }
  }
  // All perfect — pick least recently practiced.
  let sorted = [...pickable].sort((a, b) => scoreLookup(a.id).latestDate - scoreLookup(b.id).latestDate)
  return sorted.length > 0 ? { sgf: sorted[0], reason: 'least-recent' } : null
}
