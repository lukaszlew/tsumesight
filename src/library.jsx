import { useState, useEffect } from 'preact/hooks'
import { getAllSgfs, addSgf, deleteSgf } from './db.js'
import { parseSgf } from './sgf-utils.js'

export function Library({ onSelect }) {
  let [sgfs, setSgfs] = useState([])
  let [loading, setLoading] = useState(true)

  let refresh = async () => {
    let all = await getAllSgfs()
    setSgfs(all)
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  let handleFiles = async (e) => {
    let files = Array.from(e.target.files)
    for (let file of files) {
      let content = await file.text()
      let parsed = parseSgf(content)
      await addSgf({
        filename: file.name,
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

  return (
    <div class="library">
      <h1>Go Reading Trainer</h1>

      <label class="upload-btn">
        Upload SGF files
        <input type="file" accept=".sgf" multiple onChange={handleFiles} hidden />
      </label>

      {loading && <p class="loading">Loading...</p>}

      {!loading && sgfs.length === 0 && (
        <p class="empty-msg">No SGF files yet. Upload one to start training.</p>
      )}

      {sgfs.length > 0 && (
        <table class="sgf-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Size</th>
              <th>Moves</th>
              <th>Black</th>
              <th>White</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sgfs.map(s => (
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
