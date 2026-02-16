import { useState, useEffect } from 'preact/hooks'
import { Component } from 'preact'
import { Library } from './library.jsx'
import { Quiz } from './quiz.jsx'
import { getAllSgfs, updateSgf, addScore, getBestScore, kv, kvSet, kvRemove } from './db.js'

class ErrorBoundary extends Component {
  state = { error: null }
  componentDidCatch(error) {
    kvRemove('activeSgf')
    this.setState({ error: error.message })
  }
  render() {
    if (this.state.error) {
      return (
        <div class="quiz">
          <div class="summary-overlay">
            <h2>Something went wrong</h2>
            <p>{this.state.error}</p>
            <button class="back-btn" onClick={() => { this.setState({ error: null }); this.props.onReset() }}>
              Back to Library
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export function App() {
  const [attempt, setAttempt] = useState(0)
  const [position, setPosition] = useState(null)

  const [active, setActive] = useState(() => {
    let stored = kv('activeSgf')
    if (!stored) return null
    try { return JSON.parse(stored) }
    catch { kvRemove('activeSgf'); return null }
  })

  async function refreshPosition(id, path) {
    let siblings = await getSiblings(path)
    let idx = siblings.findIndex(s => s.id === id)
    setPosition({ index: idx + 1, total: siblings.length })
  }

  function selectSgf({ id, content, path, filename }) {
    let val = { id, content, path, filename }
    kvSet('activeSgf', JSON.stringify(val))
    kvSet('lastPath', path)
    setActive(val)
    history.pushState({ sgfId: id }, '')
    refreshPosition(id, path)
  }

  function clearSgf() {
    kvRemove('activeSgf')
    setActive(null)
    setPosition(null)
    history.pushState({ sgfId: null }, '')
  }

  // Replace initial history entry with current state
  useEffect(() => {
    history.replaceState({ sgfId: active?.id || null }, '')
  }, [])

  // Handle browser back/forward
  useEffect(() => {
    async function onPopState(e) {
      let sgfId = e.state?.sgfId
      if (!sgfId) {
        kvRemove('activeSgf')
        setActive(null)
        setPosition(null)
        return
      }
      let all = await getAllSgfs()
      let found = all.find(s => s.id === sgfId)
      if (!found) {
        kvRemove('activeSgf')
        setActive(null)
        setPosition(null)
        return
      }
      let val = { id: found.id, content: found.content, path: found.path || '', filename: found.filename }
      kvSet('activeSgf', JSON.stringify(val))
      kvSet('lastPath', val.path)
      setActive(val)
      refreshPosition(val.id, val.path)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (active) refreshPosition(active.id, active.path)
  }, [])

  function saveProgress({ correct, done, total }) {
    if (active.id) updateSgf(active.id, { correct, done, total })
  }

  function markSolved(correct, done, scoreEntry) {
    if (active.id) {
      updateSgf(active.id, { solved: true, correct, done })
      if (scoreEntry) addScore(active.id, scoreEntry)
    }
  }

  async function getSiblings(path) {
    let all = await getAllSgfs()
    return all
      .filter(s => (s.path || '') === (path || ''))
      .sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0) || a.filename.localeCompare(b.filename))
  }

  async function goStep(delta) {
    let siblings = await getSiblings(active.path)
    let curIdx = siblings.findIndex(s => s.id === active.id)
    let s = siblings[(curIdx + delta + siblings.length) % siblings.length]
    if (s) selectSgf({ id: s.id, content: s.content, path: s.path || '', filename: s.filename })
  }

  async function goNextUnsolved() {
    let siblings = await getSiblings(active.path)
    let curIdx = siblings.findIndex(s => s.id === active.id)
    // First unsolved
    for (let i = 1; i < siblings.length; i++) {
      let s = siblings[(curIdx + i) % siblings.length]
      if (!s.solved) {
        selectSgf({ id: s.id, content: s.content, path: s.path || '', filename: s.filename })
        return
      }
    }
    // All solved — first non-perfect
    for (let i = 1; i < siblings.length; i++) {
      let s = siblings[(curIdx + i) % siblings.length]
      let best = getBestScore(s.id)
      if (!best || best.accuracy < 1) {
        selectSgf({ id: s.id, content: s.content, path: s.path || '', filename: s.filename })
        return
      }
    }
    clearSgf()
  }

  function handleLoadError() {
    clearSgf()
  }

  if (active) {
    return (
      <ErrorBoundary onReset={clearSgf}>
        <Quiz key={`${active.id}:${attempt}`} quizKey={`${active.id}:${attempt}`} sgf={active.content}
          sgfId={active.id} filename={active.filename} dirName={active.path}
          onBack={clearSgf} onSolved={markSolved} onProgress={saveProgress} onLoadError={handleLoadError}
          onPrev={() => goStep(-1)} onNext={() => goStep(1)}
          onNextUnsolved={goNextUnsolved}
          onRetry={() => setAttempt(a => a + 1)}
          fileIndex={position?.index} fileTotal={position?.total} />
      </ErrorBoundary>
    )
  }
  return <Library onSelect={selectSgf} initialPath={kv('lastPath', '')} />
}
