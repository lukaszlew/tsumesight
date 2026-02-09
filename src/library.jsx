import { useState, useEffect } from 'preact/hooks'
import { getAllSgfs, addSgf, deleteSgf } from './db.js'
import { parseSgf } from './sgf-utils.js'

function dirOf(path) {
  if (!path) return ''
  let i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function Library({ onSelect }) {
  let [sgfs, setSgfs] = useState([])
  let [loading, setLoading] = useState(true)
  let [cwd, setCwd] = useState('')

  let refresh = async () => {
    let all = await getAllSgfs()
    setSgfs(all)
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  let handleFiles = async (e) => {
    let files = Array.from(e.target.files).filter(f => f.name.endsWith('.sgf'))
    for (let file of files) {
      let content = await file.text()
      let parsed = parseSgf(content)
      // webkitRelativePath: "dir/sub/file.sgf" — strip the filename to get dir
      let rel = file.webkitRelativePath || ''
      let path = rel ? dirOf(rel) : ''
      await addSgf({
        filename: file.name,
        path,
        content,
        boardSize: parsed.boardSize,
        moveCount: parsed.moveCount,
        playerBlack: parsed.playerBlack,
        playerWhite: parsed.playerWhite,
      })
    }
    e.target.value = ''
    refresh()
  }

  let handleDelete = async (e, id) => {
    e.stopPropagation()
    await deleteSgf(id)
    refresh()
  }

  // Files in current directory
  let filesHere = sgfs.filter(s => (s.path || '') === cwd)

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
        <label class="upload-btn">
          Upload folder
          <input type="file" webkitdirectory="" onChange={handleFiles} hidden />
        </label>
      </div>

      {cwd && (
        <div class="breadcrumbs">
          <span class="crumb" onClick={() => setCwd('')}>root</span>
          {crumbs.map((c, i) => (
            <span key={i}>
              {' / '}
              <span class="crumb" onClick={() => setCwd(crumbs.slice(0, i + 1).join('/'))}>{c}</span>
            </span>
          ))}
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
              <th>Black</th>
              <th>White</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedDirs.map(d => (
              <tr key={'d:' + d} onClick={() => setCwd(prefix + d)} class="sgf-row dir-row">
                <td>📁 {d}</td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>
            ))}
            {filesHere.map(s => (
              <tr key={s.id} onClick={() => onSelect(s.content)} class="sgf-row">
                <td>{s.filename}</td>
                <td>{s.boardSize}×{s.boardSize}</td>
                <td>{s.moveCount}</td>
                <td>{s.playerBlack || '—'}</td>
                <td>{s.playerWhite || '—'}</td>
                <td>
                  <button class="delete-btn" onClick={(e) => handleDelete(e, s.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
