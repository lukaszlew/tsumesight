const DB_NAME = 'tsumesight'
const DB_VERSION = 1
const STORE_NAME = 'sgfs'

function openDb() {
  return new Promise((resolve, reject) => {
    let request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      let db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function tx(db, mode) {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)
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
