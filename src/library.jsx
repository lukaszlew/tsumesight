import { useState, useEffect } from 'preact/hooks'
import { getAllSgfs, addSgfBatch, deleteSgf, deleteSgfsByPrefix, clearAll } from './db.js'
import { parseSgf } from './sgf-utils.js'
import { isArchive, extractSgfs } from './archive.js'
import { decodeSgf } from './sgf-utils.js'

const DEFAULT_URL = 'https://files.catbox.moe/il1jz1.zip'

let numInParens = /^(.*\()(\d+)(\)\..+)$/

function padFilenames(records) {
  // Group by path, find max number per group, zero-pad
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

function archivePrefix(entries, fallback) {
  // If all entries are inside directories and there are <10 top-level dirs, skip wrapper
  let topDirs = new Set()
  for (let { name } of entries) {
    let slash = name.indexOf('/')
    if (slash < 0) return fallback // loose file at root → use wrapper
    topDirs.add(name.slice(0, slash))
  }
  return topDirs.size < 10 ? '' : fallback
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

function ScoreCells({ correct, done, total }) {
  if (!done && !total) return <><td></td><td></td><td></td></>
  return <>
    <td class="score-good">{correct || 0}</td>
    <td>{done || 0}</td>
    <td>{total}</td>
  </>
}

export function Library({ onSelect, initialPath = '' }) {
  let [sgfs, setSgfs] = useState([])
  let [loading, setLoading] = useState(true)
  let [importing, setImporting] = useState(null) // { done, total } or null
  let [cwd, setCwd] = useState(initialPath)

  let refresh = async () => {
    let all = await getAllSgfs()
    setSgfs(all)
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  let parseAndCollect = (entries, pathPrefix, uploadedAt) => {
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

  let importBatch = async (records) => {
    setImporting({ done: 0, total: records.length })
    let BATCH = 500
    for (let i = 0; i < records.length; i += BATCH) {
      await addSgfBatch(records.slice(i, i + BATCH))
      setImporting({ done: Math.min(i + BATCH, records.length), total: records.length })
      await new Promise(r => setTimeout(r, 0)) // yield to UI
    }
    setImporting(null)
  }

  let handleFiles = async (e) => {
    let now = Date.now()
    let allRecords = []
    for (let file of Array.from(e.target.files)) {
      if (isArchive(file.name)) {
        setImporting({ done: 0, total: 0 })
        let entries = await extractSgfs(file)
        let fallback = file.name.replace(/\.(zip|tar\.gz|tgz|tar)$/i, '')
        allRecords.push(...parseAndCollect(entries, archivePrefix(entries, fallback), now))
      } else if (file.name.toLowerCase().endsWith('.sgf')) {
        let content = decodeSgf(new Uint8Array(await file.arrayBuffer()))
        allRecords.push(...parseAndCollect([{ name: file.name, content }], '', now))
      }
    }
    if (allRecords.length > 0) await importBatch(allRecords)
    e.target.value = ''
    refresh()
  }

  let handleFolder = async () => {
    let dirHandle = await window.showDirectoryPicker()
    let collected = await collectSgfFiles(dirHandle, dirHandle.name)
    let now = Date.now()
    let entries = []
    for (let { file, path } of collected) {
      let content = decodeSgf(new Uint8Array(await file.arrayBuffer()))
      entries.push({ name: path + '/' + file.name, content })
    }
    let records = parseAndCollect(entries, '', now)
    if (records.length > 0) await importBatch(records)
    refresh()
  }

  let handleUrl = async (e) => {
    e.preventDefault()
    let input = e.target.elements.url
    let url = input.value.trim()
    if (!url) return
    try {
      let resp = await fetch(url)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      let filename = url.split('/').pop().split('?')[0] || 'download.sgf'
      let blob = await resp.blob()
      let file = new File([blob], filename)
      let now = Date.now()
      let allRecords = []
      if (isArchive(filename)) {
        setImporting({ done: 0, total: 0 })
        let entries = await extractSgfs(file)
        let fallback = filename.replace(/\.(zip|tar\.gz|tgz|tar)$/i, '')
        allRecords = parseAndCollect(entries, archivePrefix(entries, fallback), now)
      } else {
        let content = decodeSgf(new Uint8Array(await file.arrayBuffer()))
        allRecords = parseAndCollect([{ name: filename, content }], '', now)
      }
      if (allRecords.length > 0) await importBatch(allRecords)
      input.value = ''
      refresh()
    } catch (err) {
      setImporting(null)
      alert(`Failed to fetch: ${err.message}\n\nThe server may block cross-origin requests. Try downloading the file and uploading it instead.`)
    }
  }

  let handleDelete = async (e, id, name) => {
    e.stopPropagation()
    if (!confirm(`Delete "${name}"?`)) return
    await deleteSgf(id)
    refresh()
  }

  let handleDeleteDir = async (e, dirPath, dirName) => {
    e.stopPropagation()
    if (!confirm(`Delete folder "${dirName}" and all its contents?`)) return
    await deleteSgfsByPrefix(dirPath)
    refresh()
  }

  let handleReset = async () => {
    if (!confirm('Delete all data and re-download default problems?')) return
    await clearAll()
    location.reload()
  }

  // Files in current directory, sorted by upload date then filename
  let filesHere = sgfs.filter(s => (s.path || '') === cwd)
    .sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0) || a.filename.localeCompare(b.filename))

  // Subdirectories of current directory
  let subdirs = new Set()
  let prefix = cwd ? cwd + '/' : ''
  for (let s of sgfs) {
    let p = s.path || ''
    if (p.startsWith(prefix) && p !== cwd) {
      let rest = p.slice(prefix.length)
      let dir = rest.split('/')[0]
      if (dir) subdirs.add(dir)
    }
  }
  let sortedDirs = [...subdirs].sort()

  // Directory stats: total, solved, and started counts
  let dirStats = {}
  for (let d of sortedDirs) {
    let dirPrefix = prefix + d
    let total = 0, solved = 0, started = 0
    for (let s of sgfs) {
      let p = s.path || ''
      if (p === dirPrefix || p.startsWith(dirPrefix + '/')) {
        total++
        if (s.solved) solved++
        else if (s.done > 0) started++
      }
    }
    dirStats[d] = { total, solved, started }
  }

  // Breadcrumb parts
  let crumbs = cwd ? cwd.split('/') : []

  return (
    <div class="library">
      <h1>TsumeSight</h1>

      <div class="upload-row">
        <label class="upload-btn">
          Upload files
          <input type="file" accept=".sgf,.zip,.tar.gz,.tgz,.tar" multiple onChange={handleFiles} hidden />
        </label>
        <button class="upload-btn" onClick={handleFolder}>
          Upload folder
        </button>
        <span class="upload-hint">SGF, ZIP, tar.gz</span>
        <button class="delete-btn" title="Delete all data and re-download defaults" onClick={handleReset}>Reset</button>
      </div>
      <form class="url-row" onSubmit={handleUrl}>
        <input class="url-input" type="text" placeholder="Paste URL to SGF or archive..." name="url"
          value={sgfs.length === 0 && !loading ? DEFAULT_URL : undefined} />
        <button class="upload-btn" type="submit">Fetch</button>
      </form>

      {importing && (
        <p class="loading">Importing {importing.done}/{importing.total}...</p>
      )}

      {cwd && (
        <div class="breadcrumbs">
          <span class="crumb" onClick={() => setCwd('')}>⌂</span>
          {crumbs.map((c, i) => (
            <span key={i}>
              <span class="crumb-sep">›</span>
              <span class={i === crumbs.length - 1 ? 'crumb-current' : 'crumb'}
                onClick={() => setCwd(crumbs.slice(0, i + 1).join('/'))}>
                {c}
              </span>
            </span>
          ))}
          <span class="dir-stats">
            <span class="score-good">{filesHere.filter(s => s.solved).length}</span>
            {filesHere.some(s => !s.solved && s.done > 0) ? '/' + filesHere.filter(s => !s.solved && s.done > 0).length : ''}
            /{filesHere.length}
          </span>
        </div>
      )}

      {loading && <p class="loading">Loading...</p>}

      {!loading && sgfs.length === 0 && (
        <p class="empty-msg">No SGF files yet. Upload files or a folder to start training.</p>
      )}

      {(sortedDirs.length > 0 || filesHere.length > 0) && (
        <table class="sgf-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Moves</th>
              <th class="score-good">Good</th>
              <th>Done</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedDirs.map(d => {
              let { solved, started, total } = dirStats[d]
              return (
                <tr key={'d:' + d} onClick={() => setCwd(prefix + d)} class="sgf-row dir-row">
                  <td>📁 {d}</td>
                  <td></td>
                  <td class="score-good">{solved}</td>
                  <td>{started || ''}</td>
                  <td>{total}</td>
                  <td>
                    <button class="delete-btn" onClick={(e) => handleDeleteDir(e, prefix + d, d)}>🗑</button>
                  </td>
                </tr>
              )
            })}
            {filesHere.map(s => (
              <tr key={s.id} onClick={() => onSelect({ id: s.id, content: s.content, path: s.path || '', filename: s.filename })} class={`sgf-row${s.solved ? ' solved-row' : ''}`}>
                <td>{s.solved ? '✓ ' : ''}{s.filename}</td>
                <td>{s.moveCount}</td>
                <ScoreCells correct={s.correct} done={s.done} total={s.total} />
                <td>
                  <button class="delete-btn" onClick={(e) => handleDelete(e, s.id, s.filename)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
