import { useState, useEffect } from 'preact/hooks'
import { getAllSgfs, addSgfBatch, deleteSgf, deleteSgfsByPrefix, clearAll, getBestScore, getLatestScoreDate, updateSgf } from './db.js'
import { parseSgf } from './sgf-utils.js'
import { isArchive, extractSgfs } from './archive.js'
import { decodeSgf } from './sgf-utils.js'

const DEFAULT_URL = 'https://files.catbox.moe/v3phv1.zip'
const isDev = location.pathname.includes('/dev/')

function scoreColor(accuracy) {
  if (accuracy >= 0.8) return '#c8a060'
  if (accuracy >= 0.5) return '#c80'
  return '#c44'
}

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

function WelcomeMessage() {
  return (
    <div class="welcome">
      <p>Upload SGF files above or click <b>Fetch</b> below to load the default collection.</p>
    </div>
  )
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

function useLongPress(callback, ms = 500) {
  let timer = null
  let onDown = (e) => {
    timer = setTimeout(() => { timer = null; callback(e) }, ms)
  }
  let cancel = () => { if (timer) { clearTimeout(timer); timer = null } }
  return { onPointerDown: onDown, onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel }
}

let deferredPrompt = null
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e })

export function Library({ onSelect, initialPath = '' }) {
  let [sgfs, setSgfs] = useState([])
  let [loading, setLoading] = useState(true)
  let [importing, setImporting] = useState(null) // { done, total } or null
  let [cwd, setCwd] = useState(initialPath)
  let [canInstall, setCanInstall] = useState(!!deferredPrompt)
  let [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    let onPrompt = (e) => { e.preventDefault(); deferredPrompt = e; setCanInstall(true) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  let handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    deferredPrompt = null
    setCanInstall(false)
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && cwd) {
        e.preventDefault()
        let parts = cwd.split('/')
        setCwd(parts.slice(0, -1).join('/'))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cwd])

  let refresh = async () => {
    let all = await getAllSgfs()
    // Backfill moveCount for old records imported before this field existed
    for (let s of all) {
      if (s.moveCount != null) continue
      try {
        s.moveCount = parseSgf(s.content).moveCount
        updateSgf(s.id, { moveCount: s.moveCount })
      } catch {}
    }
    setSgfs(all)
    setLoading(false)
  }

  useEffect(() => {
    refresh().then(async () => {
      let all = await getAllSgfs()
      if (all.length === 0) fetchUrl(DEFAULT_URL)
    })
  }, [])

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

  let fetchUrl = async (url) => {
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
      refresh()
    } catch (err) {
      setImporting(null)
      alert(`Failed to fetch: ${err.message}\n\nThe server may block cross-origin requests. Try downloading the file and uploading it instead.`)
    }
  }

  let handleDelete = async (id, name) => {
    if (!confirm(`Delete "${name}"?`)) return
    await deleteSgf(id)
    refresh()
  }

  let handleDeleteDir = async (dirPath, dirName) => {
    if (!confirm(`Delete folder "${dirName}" and all its contents?`)) return
    await deleteSgfsByPrefix(dirPath)
    refresh()
  }

  let handleReset = async () => {
    if (!confirm('Delete all data and re-download default problems?')) return
    await clearAll()
    setSgfs([])
    setCwd('')
    fetchUrl(DEFAULT_URL)
  }

  // Files in current directory, sorted by upload date then filename
  let filesHere = sgfs.filter(s => (s.path || '') === cwd)
    .sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0) || a.filename.localeCompare(b.filename))

  // Enter = next unsolved/imperfect problem
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Enter') return
      let next = filesHere.find(s => !s.solved)
        || filesHere.find(s => { let b = getBestScore(s.id); return !b || b.accuracy < 1 })
      if (!next) return
      e.preventDefault()
      onSelect({ id: next.id, content: next.content, path: next.path || '', filename: next.filename, solved: next.solved })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sgfs, cwd])

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
  // Directory stats: total, solved, started counts, latest score date
  let dirStats = {}
  for (let d of subdirs) {
    let dirPrefix = prefix + d
    let total = 0, solved = 0, started = 0, latestDate = 0
    for (let s of sgfs) {
      let p = s.path || ''
      if (p === dirPrefix || p.startsWith(dirPrefix + '/')) {
        total++
        if (s.solved) {
          solved++
          let d2 = getLatestScoreDate(s.id)
          if (d2 > latestDate) latestDate = d2
        }
        else if (s.done > 0) started++
      }
    }
    dirStats[d] = { total, solved, started, latestDate }
  }
  let sortedDirs = [...subdirs].sort((a, b) =>
    dirStats[b].latestDate - dirStats[a].latestDate || a.localeCompare(b)
  )

  // Breadcrumb parts
  let crumbs = cwd ? cwd.split('/') : []

  return (
    <div class="library">
      <h1>TsumeSight</h1>

      {filesHere.length > 0 && (() => {
        let solvedCount = filesHere.filter(s => s.solved).length
        let unsolved = filesHere.find(s => !s.solved)
        if (unsolved) {
          let select = () => onSelect({ id: unsolved.id, content: unsolved.content, path: unsolved.path || '', filename: unsolved.filename, solved: unsolved.solved })
          return <>
            <div class="progress-hero" title="Problems solved in this folder">
              <span class="progress-num">{solvedCount}</span>
              <span class="progress-sep">/</span>
              <span class="progress-den">{filesHere.length}</span>
            </div>
            <button class="next-hero" title="First unsolved problem" onClick={select}>Next</button>
          </>
        }
        let imperfect = filesHere.find(s => { let b = getBestScore(s.id); return !b || b.accuracy < 1 })
        if (imperfect) {
          let select = () => onSelect({ id: imperfect.id, content: imperfect.content, path: imperfect.path || '', filename: imperfect.filename, solved: imperfect.solved })
          return <>
            <div class="progress-hero complete" title="All problems solved">
              <span class="progress-num">{solvedCount}</span>
              <span class="progress-sep">/</span>
              <span class="progress-den">{filesHere.length}</span>
            </div>
            <button class="next-hero" title="All solved — first without 100% accuracy" onClick={select}>Next</button>
          </>
        }
        return <div class="complete-badge">All Perfect</div>
      })()}

      <div class="menu-wrap">
        <button class="menu-toggle" title="Menu" onClick={() => setMenuOpen(v => !v)}>☰</button>
        {menuOpen && <>
          <div class="menu-backdrop" onClick={() => setMenuOpen(false)} />
          <div class="menu-dropdown">
            <label class="menu-item">
              Upload files
              <input type="file" accept=".sgf,.zip,.tar.gz,.tgz,.tar" multiple onChange={e => { setMenuOpen(false); handleFiles(e) }} hidden />
            </label>
            <button class="menu-item" onClick={() => { setMenuOpen(false); handleFolder() }}>Upload folder</button>
            <button class="menu-item" onClick={() => {
              setMenuOpen(false)
              let url = prompt('Enter URL to SGF or archive:', DEFAULT_URL)
              if (url) fetchUrl(url)
            }}>Upload from URL</button>
            {canInstall && <button class="menu-item" onClick={() => { setMenuOpen(false); handleInstall() }}>Install app</button>}
            <button class="menu-item menu-danger" onClick={() => { setMenuOpen(false); handleReset() }}>Reset all data</button>
            <div class="menu-sep" />
            {isDev
              ? <a class="menu-item" href="../">Go to Prod</a>
              : <a class="menu-item" href="dev/">Go to Dev</a>}
          </div>
        </>}
      </div>

      {importing && (
        <p class="loading">Importing {importing.done}/{importing.total}...</p>
      )}

      {cwd && (
        <div class="breadcrumbs">
          <span class="crumb" title="Go to root folder" onClick={() => setCwd('')}>⌂</span>
          {crumbs.map((c, i) => (
            <span key={i}>
              <span class="crumb-sep">›</span>
              <span class={i === crumbs.length - 1 ? 'crumb-current' : 'crumb'}
                onClick={() => setCwd(crumbs.slice(0, i + 1).join('/'))}>
                {c}
              </span>
            </span>
          ))}
        </div>
      )}

      {loading && <p class="loading">Loading...</p>}

      {!loading && sgfs.length === 0 && <WelcomeMessage />}

      {sortedDirs.length > 0 && (
        <div class="tile-grid">
          {sortedDirs.map(d => {
            let { solved, total } = dirStats[d]
            let lp = useLongPress(() => handleDeleteDir(prefix + d, d))
            return (
              <div key={'d:' + d} class={`tile dir-tile${solved === total ? ' dir-complete' : ''}`} onClick={() => setCwd(prefix + d)} {...lp}>
                <div class="tile-name">{d}</div>
                <div class="dir-count" title={`${solved} of ${total} solved`}>
                  <span class="dir-count-num">{solved}</span>
                  <span class="dir-count-sep">/</span>
                  <span class="dir-count-den">{total}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {filesHere.length > 0 && (
        <div class="tile-grid">
          {filesHere.map(s => {
            let best = getBestScore(s.id)
            let lp = useLongPress(() => handleDelete(s.id, s.filename))
            return (
              <div key={s.id} class={`tile file-tile${s.solved ? ' tile-solved' : ''}`}
                onClick={() => onSelect({ id: s.id, content: s.content, path: s.path || '', filename: s.filename, solved: s.solved })} {...lp}>
                <span class="tile-num" title="Number of moves">{s.moveCount || '?'}</span>
                <span class={`tile-acc${best && best.accuracy >= 1 ? ' tile-perfect' : ''}`}
                  title="Best score"
                  style={best && best.accuracy < 1 ? { color: scoreColor(best.accuracy) } : undefined}
                >{best ? Math.round(best.accuracy * 100) + '%' : ''}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
