const DB_NAME = 'tsumesight'
const DB_VERSION = 2
const STORE_NAME = 'sgfs'
const KV_STORE = 'kv'

function openDb() {
  return new Promise((resolve, reject) => {
    let request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      let db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(KV_STORE)) {
        db.createObjectStore(KV_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function tx(db, mode, store = STORE_NAME) {
  return db.transaction(store, mode).objectStore(store)
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function getAllSgfs() {
  let db = await openDb()
  return promisify(tx(db, 'readonly').getAll())
}

export async function addSgf(record) {
  let db = await openDb()
  return promisify(tx(db, 'readwrite').add(record))
}

export async function addSgfBatch(records) {
  let db = await openDb()
  let store = tx(db, 'readwrite')
  for (let r of records) store.add(r)
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve(records.length)
    store.transaction.onerror = () => reject(store.transaction.error)
  })
}

export async function updateSgf(id, fields) {
  let db = await openDb()
  let store = tx(db, 'readwrite')
  let record = await promisify(store.get(id))
  Object.assign(record, fields)
  return promisify(store.put(record))
}

export async function deleteSgf(id) {
  let db = await openDb()
  return promisify(tx(db, 'readwrite').delete(id))
}

export async function deleteSgfsByPrefix(prefix) {
  let db = await openDb()
  let all = await promisify(tx(db, 'readonly').getAll())
  let store = tx(db, 'readwrite')
  let count = 0
  for (let s of all) {
    let p = s.path || ''
    if (p === prefix || p.startsWith(prefix + '/')) {
      store.delete(s.id)
      count++
    }
  }
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve(count)
    store.transaction.onerror = () => reject(store.transaction.error)
  })
}

export async function renameSgfsByPrefix(oldPrefix, newPrefix) {
  let db = await openDb()
  let all = await promisify(tx(db, 'readonly').getAll())
  let store = tx(db, 'readwrite')
  for (let s of all) {
    let p = s.path || ''
    if (p === oldPrefix) {
      s.path = newPrefix
      store.put(s)
    } else if (p.startsWith(oldPrefix + '/')) {
      s.path = newPrefix + p.slice(oldPrefix.length)
      store.put(s)
    }
  }
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve()
    store.transaction.onerror = () => reject(store.transaction.error)
  })
}

// Key-value store with sync in-memory cache, async IDB persistence
let kvCache = {}

export async function loadKv() {
  let db = await openDb()
  let all = await promisify(tx(db, 'readonly', KV_STORE).getAll())
  let keys = await promisify(tx(db, 'readonly', KV_STORE).getAllKeys())
  kvCache = {}
  for (let i = 0; i < keys.length; i++) kvCache[keys[i]] = all[i]
}

export function kv(key, fallback) {
  let val = kvCache[key]
  return val !== undefined ? val : fallback
}

// kv writes are fire-and-forget. The in-memory cache makes them
// effectively synchronous to readers; the IDB write is best-effort
// durability. Tests provide a fake IndexedDB via src/test-setup.js so
// production IDB errors surface instead of being swallowed.
export function kvSet(key, value) {
  kvCache[key] = value
  openDb().then(db => promisify(tx(db, 'readwrite', KV_STORE).put(value, key)))
}

export function kvRemove(key) {
  delete kvCache[key]
  openDb().then(db => promisify(tx(db, 'readwrite', KV_STORE).delete(key)))
}

export function getScores(sgfId) {
  let raw = kv(`scores:${sgfId}`)
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

export function addScore(sgfId, entry) {
  let scores = getScores(sgfId)
  scores.push(entry)
  kvSet(`scores:${sgfId}`, JSON.stringify(scores))
}

export function getBestScore(sgfId) {
  let scores = getScores(sgfId)
  if (scores.length === 0) return null
  return scores.reduce((best, s) =>
    s.accuracy > best.accuracy || (s.accuracy === best.accuracy && (s.totalMs || Infinity) < (best.totalMs || Infinity)) ? s : best
  )
}

// Write an enriched replay record (v:3). Payload shape:
//   { events, config, viewport, goldens }
// Mirrors the fixture schema so the converter can promote this directly
// into a committed test fixture. See src/fixture-schema.js.
export function addReplay(sgfId, date, payload) {
  kvSet(`replay:${sgfId}:${date}`, JSON.stringify({ v: 3, ...payload }))
}

// Read a replay record, normalized to the v:3 shape regardless of what
// was stored. v:2 records return with null config/viewport/goldens; older
// or unparseable records return null. Callers that only need events
// destructure `.events`.
export function getReplay(sgfId, date) {
  let raw = kv(`replay:${sgfId}:${date}`)
  if (!raw) return null
  try {
    let parsed = JSON.parse(raw)
    if (!parsed) return null
    if (parsed.v === 3) return parsed
    if (parsed.v === 2) return { v: 3, events: parsed.events, config: null, viewport: null, goldens: null }
    return null
  } catch { return null }
}

export function getLatestScoreDate(sgfId) {
  let scores = getScores(sgfId)
  if (scores.length === 0) return 0
  return Math.max(...scores.map(s => s.date || 0))
}

// Latest replay events for this sgf, or null if none stored in the current
// format (v2). Used to restore a solved puzzle by folding the events back
// through a fresh session.
export function getLatestReplay(sgfId) {
  let date = getLatestScoreDate(sgfId)
  if (!date) return null
  return getReplay(sgfId, date)
}

export async function exportDb() {
  let db = await openDb()
  let sgfs = await promisify(tx(db, 'readonly').getAll())
  let kvKeys = await promisify(tx(db, 'readonly', KV_STORE).getAllKeys())
  let kvVals = await promisify(tx(db, 'readonly', KV_STORE).getAll())
  let kvData = {}
  for (let i = 0; i < kvKeys.length; i++) kvData[kvKeys[i]] = kvVals[i]
  return { version: DB_VERSION, exportedAt: new Date().toISOString(), sgfs, kv: kvData }
}

export async function downloadExport(data) {
  let { default: JSZip } = await import('jszip')
  let zip = new JSZip()
  zip.file('tsumesight.json', JSON.stringify(data))
  let blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  let url = URL.createObjectURL(blob)
  let a = document.createElement('a')
  a.href = url
  a.download = `tsumesight-${new Date().toISOString().slice(0, 10)}.zip`
  a.click()
  URL.revokeObjectURL(url)
}

export async function clearAll() {
  let db = await openDb()
  await promisify(tx(db, 'readwrite').clear())
  await promisify(tx(db, 'readwrite', KV_STORE).clear())
  kvCache = {}
  localStorage.clear()
  sessionStorage.clear()
}
