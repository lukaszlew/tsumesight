import { useState, useEffect } from 'preact/hooks'
import { getAllSgfs, addSgf, deleteSgf, deleteSgfsByPrefix } from './db.js'
import { parseSgf } from './sgf-utils.js'

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

export function Library({ onSelect, initialPath = '' }) {
  let [sgfs, setSgfs] = useState([])
  let [loading, setLoading] = useState(true)
  let [cwd, setCwd] = useState(initialPath)

  let refresh = async () => {
    let all = await getAllSgfs()
    setSgfs(all)
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  let addParsedFile = async (file, path, uploadedAt) => {
    try {
      let content = await file.text()
      let parsed = parseSgf(content)
      await addSgf({
        filename: file.name,
        path,
        content,
        boardSize: parsed.boardSize,
        moveCount: parsed.moveCount,
        playerBlack: parsed.playerBlack,
        playerWhite: parsed.playerWhite,
        uploadedAt,
      })
    } catch {
      console.warn('Skipping unparseable SGF:', file.name)
    }
  }

  let handleFiles = async (e) => {
    let files = Array.from(e.target.files).filter(f => f.name.endsWith('.sgf'))
    let now = Date.now()
    for (let file of files) await addParsedFile(file, '', now)
    e.target.value = ''
    refresh()
  }

  let handleFolder = async () => {
    let dirHandle = await window.showDirectoryPicker()
    let entries = await collectSgfFiles(dirHandle, dirHandle.name)
    let now = Date.now()
    for (let { file, path } of entries) await addParsedFile(file, path, now)
    refresh()
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

  // Directory stats: total and solved counts
  let dirStats = {}
  for (let d of sortedDirs) {
    let dirPrefix = prefix + d
    let total = 0, solved = 0
    for (let s of sgfs) {
      let p = s.path || ''
      if (p === dirPrefix || p.startsWith(dirPrefix + '/')) {
        total++
        if (s.solved) solved++
      }
    }
    dirStats[d] = { total, solved }
  }

  // Breadcrumb parts
  let crumbs = cwd ? cwd.split('/') : []

  return (
    <div class="library">
      <h1>Go Reading Trainer</h1>

      <div class="upload-row">
        <label class="upload-btn">
          Upload SGF files
          <input type="file" accept=".sgf" multiple onChange={handleFiles} hidden />
        </label>
        <button class="upload-btn" onClick={handleFolder}>
          Upload folder
        </button>
      </div>

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
          <span class="dir-stats">{filesHere.filter(s => s.solved).length}/{filesHere.length}</span>
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
              <th>Size</th>
              <th>Moves</th>
              <th>Score</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedDirs.map(d => (
              <tr key={'d:' + d} onClick={() => setCwd(prefix + d)} class="sgf-row dir-row">
                <td>📁 {d}</td>
                <td></td>
                <td></td>
                <td>{dirStats[d].solved}/{dirStats[d].total}</td>
                <td>
                  <button class="delete-btn" onClick={(e) => handleDeleteDir(e, prefix + d, d)}>🗑</button>
                </td>
              </tr>
            ))}
            {filesHere.map(s => (
              <tr key={s.id} onClick={() => onSelect({ id: s.id, content: s.content, path: s.path || '' })} class={`sgf-row${s.solved ? ' solved-row' : ''}`}>
                <td>{s.solved ? '✓ ' : ''}{s.filename}</td>
                <td>{s.boardSize}×{s.boardSize}</td>
                <td>{s.moveCount}</td>
                <td>{s.total ? `${s.correct}/${s.total}` : '—'}</td>
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
