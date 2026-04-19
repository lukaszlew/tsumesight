import { useState, useEffect } from 'preact/hooks'
import { getAllSgfs, addSgfBatch, deleteSgf, deleteSgfsByPrefix, renameSgfsByPrefix, clearAll, getBestScore, getLatestScoreDate, updateSgf, exportDb, downloadExport, getScores } from './db.js'
import { starsFromScore, StarsDisplay } from './scoring.js'
import { parseSgf } from './sgf-utils.js'
import { siblings as siblingsAt, nextUnsolved, toSelection } from './navigation.js'
import { importFiles, importFolder, importUrl } from './importer.js'
import { GIT_SHA, GIT_DATE, GIT_DATE_SHORT, BUILD_TIME } from './version.js'
import { usePwaInstall } from './usePwaInstall.js'

const DEFAULT_URL = 'https://files.catbox.moe/v3phv1.zip'
const isDev = location.pathname.includes('/dev/')

function splitDirName(name) {
  // Split long names into two lines at comma or dash
  let i = name.indexOf(',')
  if (i === -1) i = name.indexOf(' - ')
  if (i === -1) i = name.indexOf('-')
  if (i === -1) return name
  let sep = name[i] === ',' ? ', ' : name.slice(i).startsWith(' - ') ? ' - ' : '-'
  let line1 = name.slice(0, i).trim()
  let line2 = name.slice(i + sep.length).trim()
  return <>{line1}<br />{line2}</>
}

function scoreColor(accuracy) {
  if (accuracy >= 0.8) return '#c8a060'
  if (accuracy >= 0.5) return '#c80'
  return '#c44'
}

function WelcomeMessage() {
  return (
    <div class="welcome">
      <p>Upload SGF files above or click <b>Fetch</b> below to load the default collection.</p>
    </div>
  )
}

function useLongPress(callback, ms = 500) {
  let timer = null
  let onDown = (e) => {
    timer = setTimeout(() => { timer = null; callback(e) }, ms)
  }
  let cancel = () => { if (timer) { clearTimeout(timer); timer = null } }
  return { onPointerDown: onDown, onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel }
}

export function Library({ onSelect, cwd, onCwdChange }) {
  let [sgfs, setSgfs] = useState([])
  let [loading, setLoading] = useState(true)
  let [importing, setImporting] = useState(null) // { done, total } or null
  let [menuOpen, setMenuOpen] = useState(false)
  let { canInstall, install: handleInstall } = usePwaInstall()

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && cwd) {
        e.preventDefault()
        let parts = cwd.split('/')
        onCwdChange(parts.slice(0, -1).join('/'))
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

  // Batch-write records to the DB with progress updates.
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
    let records = await importFiles(e.target.files, {
      onArchiveStart: () => setImporting({ done: 0, total: 0 }),
    })
    if (records.length > 0) await importBatch(records)
    e.target.value = ''
    refresh()
  }

  let handleFolder = async () => {
    let dirHandle = await window.showDirectoryPicker()
    let records = await importFolder(dirHandle)
    if (records.length > 0) await importBatch(records)
    refresh()
  }

  let fetchUrl = async (url) => {
    try {
      let records = await importUrl(url, {
        onArchiveStart: () => setImporting({ done: 0, total: 0 }),
      })
      if (records.length > 0) await importBatch(records)
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

  let handleRenameDir = async (dirPath, dirName) => {
    let newName = prompt(`Rename "${dirName}" to:`, dirName)
    if (!newName || newName === dirName) return
    let parentPath = dirPath.slice(0, dirPath.length - dirName.length)
    let newPath = parentPath + newName
    await renameSgfsByPrefix(dirPath, newPath)
    refresh()
  }

  let handleReset = async () => {
    if (!confirm('Delete all data and re-download default problems?')) return
    await clearAll()
    setSgfs([])
    onCwdChange('')
    fetchUrl(DEFAULT_URL)
  }

  // Files in current directory, sorted by upload date then filename
  let filesHere = siblingsAt(sgfs, cwd)

  // Shared scoreLookup for nextUnsolved — wraps db calls.
  let scoreLookup = (id) => {
    let b = getBestScore(id)
    return { bestAccuracy: b ? b.accuracy : null, latestDate: getLatestScoreDate(id) }
  }

  // Enter = next unsolved/imperfect problem. Reused by the progress-hero
  // button below.
  function selectNext() {
    let r = nextUnsolved(filesHere, null, scoreLookup)
    if (!r || r.reason === 'least-recent') return  // All perfect: button is hidden
    onSelect(toSelection(r.sgf))
  }
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Enter') return
      let r = nextUnsolved(filesHere, null, scoreLookup)
      if (!r || r.reason === 'least-recent') return
      e.preventDefault()
      onSelect(toSelection(r.sgf))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sgfs, cwd])

  // Subdirectories of current directory + their stats — single pass over
  // sgfs, bucketed by top-level subdir name under cwd. O(n+d) replacing
  // the old O(dirs × sgfs) scan.
  let prefix = cwd ? cwd + '/' : ''
  let dirStats = {}
  for (let s of sgfs) {
    let p = s.path || ''
    if (!p.startsWith(prefix) || p === cwd) continue
    let dir = p.slice(prefix.length).split('/')[0]
    if (!dir) continue
    let st = dirStats[dir] ||= { total: 0, solved: 0, started: 0, latestDate: 0 }
    st.total++
    if (s.solved) {
      st.solved++
      let d2 = getLatestScoreDate(s.id)
      if (d2 > st.latestDate) st.latestDate = d2
    } else if (s.done > 0) {
      st.started++
    }
  }
  let sortedDirs = Object.keys(dirStats).sort((a, b) =>
    dirStats[b].latestDate - dirStats[a].latestDate || a.localeCompare(b)
  )

  // Breadcrumb parts
  let crumbs = cwd ? cwd.split('/') : []

  return (
    <div class="library">
      <h1>TsumeSight</h1>

      {filesHere.length > 0 && (() => {
        let solvedCount = filesHere.filter(s => s.solved).length
        let r = nextUnsolved(filesHere, null, scoreLookup)
        if (!r || r.reason === 'least-recent') {
          return <div class="complete-badge">All Perfect</div>
        }
        let complete = r.reason === 'imperfect' ? ' complete' : ''
        let title = r.reason === 'unsolved' ? 'First unsolved problem' : 'All solved — first without 100% accuracy'
        let heroTitle = r.reason === 'unsolved' ? 'Problems solved in this folder' : 'All problems solved'
        return <>
          <div class={`progress-hero${complete}`} title={heroTitle}>
            <span class="progress-num">{solvedCount}</span>
            <span class="progress-sep">/</span>
            <span class="progress-den">{filesHere.length}</span>
          </div>
          <button class="next-hero" title={title} onClick={selectNext}>Next</button>
        </>
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
              let url = prompt('Enter URL to SGF or archive:', 'https://files.catbox.moe/r92xsw.zip')
              if (url) fetchUrl(url)
            }}>Upload from URL</button>
            <button class="menu-item" onClick={async () => { setMenuOpen(false); downloadExport(await exportDb()) }}>Export data</button>
            {canInstall && <button class="menu-item" onClick={() => { setMenuOpen(false); handleInstall() }}>Install app</button>}
            <button class="menu-item menu-danger" onClick={() => { setMenuOpen(false); handleReset() }}>Reset all data</button>
            <div class="menu-sep" />
            <div class="env-toggle">
              <a class={`env-btn${isDev ? '' : ' env-active'}`} href={isDev ? '../' : undefined} onClick={() => localStorage.setItem('preferredEnv', 'prod')}>Prod</a>
              <a class={`env-btn${isDev ? ' env-active' : ''}`} href={isDev ? undefined : 'dev/'} onClick={() => localStorage.setItem('preferredEnv', 'dev')}>Dev</a>
            </div>
            <div class="menu-version" title={`commit ${GIT_DATE}\nbuilt  ${BUILD_TIME || ''}`}>
              <div>{GIT_SHA}{GIT_DATE_SHORT && ` · ${GIT_DATE_SHORT}`}</div>
            </div>
          </div>
        </>}
      </div>

      {importing && (
        <p class="loading">Importing {importing.done}/{importing.total}...</p>
      )}

      {cwd && (
        <div class="breadcrumbs">
          <span class="crumb" title="Go to root folder" onClick={() => onCwdChange('')}>⌂</span>
          {crumbs.map((c, i) => (
            <span key={i}>
              <span class="crumb-sep">›</span>
              <span class={i === crumbs.length - 1 ? 'crumb-current' : 'crumb'}
                onClick={() => onCwdChange(crumbs.slice(0, i + 1).join('/'))}>
                {c}
              </span>
            </span>
          ))}
        </div>
      )}

      {loading && <p class="loading">Loading...</p>}

      {!loading && sgfs.length === 0 && <WelcomeMessage />}

      {cwd && (() => {
        let dirName = cwd.split('/').pop()
        let total = 0, solved = 0
        for (let s of sgfs) {
          let p = s.path || ''
          if (p === cwd || p.startsWith(cwd + '/')) { total++; if (s.solved) solved++ }
        }
        if (total === 0) return null
        return (
          <div class={`dir-header-tile${solved === total ? ' dir-complete' : ''}`}>
            <div class="dir-count" title={`${solved} of ${total} solved`}>
              <span class="dir-count-num">{solved}</span>
              <span class="dir-count-sep">/</span>
              <span class="dir-count-den">{total}</span>
            </div>
            <div class="tile-name">{splitDirName(dirName)}</div>
          </div>
        )
      })()}

      {sortedDirs.length > 0 && (
        <div class="tile-grid">
          {sortedDirs.map(d => {
            let { solved, total } = dirStats[d]
            return (
              <div key={'d:' + d} class={`tile dir-tile${solved === total ? ' dir-complete' : ''}`} onClick={() => onCwdChange(prefix + d)}>
                <div class="dir-count" title={`${solved} of ${total} solved`}>
                  <span class="dir-count-num">{solved}</span>
                  <span class="dir-count-sep">/</span>
                  <span class="dir-count-den">{total}</span>
                </div>
                <div class="tile-name">{splitDirName(d)}</div>
                <div class="dir-actions">
                  <button class="dir-action-btn" title="Rename folder" onClick={e => { e.stopPropagation(); handleRenameDir(prefix + d, d) }}>&#x270E;</button>
                  <button class="dir-action-btn dir-action-delete" title="Delete folder" onClick={e => { e.stopPropagation(); handleDeleteDir(prefix + d, d) }}>&times;</button>
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
            let stars = best ? starsFromScore(best) : 0
            let lp = useLongPress(() => handleDelete(s.id, s.filename))
            return (
              <div key={s.id} class={`tile file-tile${s.solved ? ' tile-solved' : ''}`}
                onClick={() => onSelect(toSelection(s))} {...lp}>
                <span class="tile-num" title="Number of moves">{s.moveCount || '?'}</span>
                {stars > 0
                  ? <span class="tile-stars" title={`${stars}/5 stars`}>
                      <StarsDisplay stars={stars} wrapClass="" trophyClass="tile-trophy" medalClass="tile-medal" offClass="star-off" onClass="star-on" />
                    </span>
                  : <span class={`tile-acc${best && best.accuracy >= 1 ? ' tile-perfect' : ''}`}
                      title="Best score"
                      style={best && best.accuracy < 1 ? { color: scoreColor(best.accuracy) } : undefined}
                    >{best ? Math.round(best.accuracy * 100) + '%' : ''}</span>
                }
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
