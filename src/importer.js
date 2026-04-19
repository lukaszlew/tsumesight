// Import pipeline: files / folders / URLs → parsed SGF records.
// Used by library.jsx. All DB writes stay in the caller; importer just
// returns records and reports progress.

import { parseSgf, decodeSgf } from './sgf-utils.js'
import { isArchive, extractSgfs } from './archive.js'

const numInParens = /^(.*\()(\d+)(\)\..+)$/

// Zero-pad trailing "(N)" in filenames per directory so sort order is
// natural ("foo (01).sgf" before "foo (10).sgf").
export function padFilenames(records) {
  let byPath = new Map()
  for (let r of records) {
    let m = numInParens.exec(r.filename)
    if (!m) continue
    let list = byPath.get(r.path)
    if (!list) { list = []; byPath.set(r.path, list) }
    list.push({ record: r, prefix: m[1], num: parseInt(m[2]), suffix: m[3] })
  }
  for (let entries of byPath.values()) {
    let maxN = Math.max(...entries.map(e => e.num))
    let width = String(maxN).length
    for (let { record, prefix, num, suffix } of entries) {
      record.filename = prefix + String(num).padStart(width, '0') + suffix
    }
  }
}

// If all entries live under subdirectories and there are fewer than 10
// top-level dirs, skip the wrapper (use '' instead of fallback).
// Otherwise use fallback (typically the archive filename without ext).
export function archivePrefix(entries, fallback) {
  let topDirs = new Set()
  for (let { name } of entries) {
    let slash = name.indexOf('/')
    if (slash < 0) return fallback
    topDirs.add(name.slice(0, slash))
  }
  return topDirs.size < 10 ? '' : fallback
}

// Parse entries → records with metadata. Silently skips unparseable SGFs.
// pathPrefix is prepended to each entry's internal directory path.
export function parseAndCollect(entries, pathPrefix, uploadedAt) {
  let records = []
  for (let { name, content } of entries) {
    try {
      let parts = name.split('/')
      let filename = parts.pop()
      let path = [pathPrefix, ...parts].filter(Boolean).join('/')
      let parsed = parseSgf(content)
      records.push({
        filename, path, content,
        boardSize: parsed.boardSize,
        moveCount: parsed.moveCount,
        playerBlack: parsed.playerBlack,
        playerWhite: parsed.playerWhite,
        uploadedAt,
      })
    } catch {
      console.warn('Skipping unparseable SGF:', name)
    }
  }
  padFilenames(records)
  return records
}

async function collectSgfFiles(dirHandle, path) {
  let results = []
  for await (let [name, handle] of dirHandle) {
    if (handle.kind === 'file' && name.endsWith('.sgf')) {
      let file = await handle.getFile()
      results.push({ file, path })
    } else if (handle.kind === 'directory') {
      let sub = path ? path + '/' + name : name
      results.push(...await collectSgfFiles(handle, sub))
    }
  }
  return results
}

// Import from a FileList (input type=file multi). Each entry may be a
// .sgf or an archive. Returns the full list of records; caller batches
// into the DB.
export async function importFiles(fileList, { onArchiveStart } = {}) {
  let now = Date.now()
  let records = []
  for (let file of Array.from(fileList)) {
    if (isArchive(file.name)) {
      onArchiveStart?.()
      let entries = await extractSgfs(file)
      let fallback = file.name.replace(/\.(zip|tar\.gz|tgz|tar)$/i, '')
      records.push(...parseAndCollect(entries, archivePrefix(entries, fallback), now))
    } else if (file.name.toLowerCase().endsWith('.sgf')) {
      let content = decodeSgf(new Uint8Array(await file.arrayBuffer()))
      records.push(...parseAndCollect([{ name: file.name, content }], '', now))
    }
  }
  return records
}

// Import from a DirectoryHandle (File System Access API).
export async function importFolder(dirHandle) {
  let collected = await collectSgfFiles(dirHandle, dirHandle.name)
  let now = Date.now()
  let entries = []
  for (let { file, path } of collected) {
    let content = decodeSgf(new Uint8Array(await file.arrayBuffer()))
    entries.push({ name: path + '/' + file.name, content })
  }
  return parseAndCollect(entries, '', now)
}

// Import from a URL. Follows the same classification as importFiles —
// .sgf or archive. Throws on network / HTTP errors; caller surfaces to
// the user.
export async function importUrl(url, { onArchiveStart } = {}) {
  let resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  let filename = url.split('/').pop().split('?')[0] || 'download.sgf'
  let blob = await resp.blob()
  let file = new File([blob], filename)
  let now = Date.now()
  if (isArchive(filename)) {
    onArchiveStart?.()
    let entries = await extractSgfs(file)
    let fallback = filename.replace(/\.(zip|tar\.gz|tgz|tar)$/i, '')
    return parseAndCollect(entries, archivePrefix(entries, fallback), now)
  }
  let content = decodeSgf(new Uint8Array(await file.arrayBuffer()))
  return parseAndCollect([{ name: filename, content }], '', now)
}
