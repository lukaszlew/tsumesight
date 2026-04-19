import { useState } from 'preact/hooks'
import { Component } from 'preact'
import { Library } from './library.jsx'
import { Quiz } from './quiz.jsx'
import { getAllSgfs, updateSgf, addScore, getBestScore, getLatestScoreDate, kv, kvSet, kvRemove } from './db.js'
import { siblings as siblingsAt, stepSibling, nextUnsolved } from './navigation.js'

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
  const [active, setActive] = useState(() => {
    let saved = kv('activeSgf')
    if (!saved) return null
    try { let a = JSON.parse(saved); a.restored = true; return a } catch { return null }
  })
  const [cwd, setCwd] = useState(() => kv('lastPath', ''))

  function selectSgf({ id, content, path, filename, solved }) {
    let val = { id, content, path, filename, solved: !!solved }
    kvSet('activeSgf', JSON.stringify(val))
    kvSet('lastPath', path)
    setCwd(path)
    setActive(val)
  }

  function clearSgf() {
    kvRemove('activeSgf')
    setActive(null)
  }

  function changeCwd(newCwd) {
    setCwd(newCwd)
    kvSet('lastPath', newCwd)
  }

  function saveProgress({ correct, done, total }) {
    updateSgf(active.id, { correct, done, total })
  }

  function markSolved(correct, done, scoreEntry) {
    updateSgf(active.id, { solved: true, correct, done })
    if (scoreEntry) addScore(active.id, scoreEntry)
    setActive(prev => {
      let next = { ...prev, solved: true }
      kvSet('activeSgf', JSON.stringify(next))
      return next
    })
  }

  let scoreLookup = (id) => {
    let b = getBestScore(id)
    return { bestAccuracy: b ? b.accuracy : null, latestDate: getLatestScoreDate(id) }
  }

  async function goStep(delta) {
    let all = await getAllSgfs()
    let list = siblingsAt(all, active.path)
    let next = stepSibling(list, active.id, delta)
    if (next) selectSgf({ id: next.id, content: next.content, path: next.path || '', filename: next.filename })
  }

  async function goNextUnsolved() {
    let all = await getAllSgfs()
    let list = siblingsAt(all, active.path)
    let r = nextUnsolved(list, active.id, scoreLookup)
    if (r) selectSgf({ id: r.sgf.id, content: r.sgf.content, path: r.sgf.path || '', filename: r.sgf.filename })
    else clearSgf()
  }

  if (active) {
    return (
      <ErrorBoundary onReset={clearSgf}>
        <Quiz key={active.id} sgf={active.content}
          sgfId={active.id}
          wasSolved={active.solved} restored={!!active.restored}
          onBack={clearSgf} onSolved={markSolved} onProgress={saveProgress} onLoadError={clearSgf}
          onPrev={() => goStep(-1)} onNext={() => goStep(1)}
          onNextUnsolved={goNextUnsolved} />
      </ErrorBoundary>
    )
  }
  return <Library onSelect={selectSgf} cwd={cwd} onCwdChange={changeCwd} />
}
