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

// Key-value store with sync in-memory cache, async IDB persistence
let kvCache = {}

export async function loadKv() {
  let db = await openDb()
  let all = await promisify(tx(db, 'readonly', KV_STORE).getAll())
  let keys = await promisify(tx(db, 'readonly', KV_STORE).getAllKeys())
  kvCache = {}
  for (let i = 0; i < keys.length; i++) kvCache[keys[i]] = all[i]
  // Migrate from localStorage/sessionStorage
  let migrations = ['quizMode', 'quizMaxQ', 'quizShowDuration', 'sound', 'quizHistory', 'activeSgf', 'lastPath']
  let needsMigrate = false
  for (let key of migrations) {
    let val = localStorage.getItem(key) ?? sessionStorage.getItem(key)
    if (val != null && !(key in kvCache)) {
      kvCache[key] = val
      needsMigrate = true
    }
  }
  if (needsMigrate) {
    let store = tx(await openDb(), 'readwrite', KV_STORE)
    for (let key of migrations) {
      if (key in kvCache) store.put(kvCache[key], key)
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    }
  }
}

export function kv(key, fallback) {
  let val = kvCache[key]
  return val !== undefined ? val : fallback
}

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
    s.accuracy > best.accuracy || (s.accuracy === best.accuracy && s.avgTimeMs < best.avgTimeMs) ? s : best
  )
}

export function getLatestScoreDate(sgfId) {
  let scores = getScores(sgfId)
  if (scores.length === 0) return 0
  return Math.max(...scores.map(s => s.date || 0))
}

export async function clearAll() {
  let db = await openDb()
  await promisify(tx(db, 'readwrite').clear())
  await promisify(tx(db, 'readwrite', KV_STORE).clear())
  kvCache = {}
  localStorage.clear()
  sessionStorage.clear()
}
