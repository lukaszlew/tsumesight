import { useState } from 'preact/hooks'
import { Library } from './library.jsx'
import { Quiz } from './quiz.jsx'
import { getAllSgfs, updateSgf } from './db.js'

export function App() {
  const [attempt, setAttempt] = useState(0)

  const [active, setActive] = useState(() => {
    let stored = sessionStorage.getItem('activeSgf')
    if (!stored) return null
    try { return JSON.parse(stored) }
    catch { sessionStorage.removeItem('activeSgf'); return null }
  })

  function selectSgf({ id, content, path }) {
    let val = { id, content, path }
    sessionStorage.setItem('activeSgf', JSON.stringify(val))
    setActive(val)
  }

  function clearSgf() {
    sessionStorage.removeItem('activeSgf')
    setActive(null)
  }

  function markSolved() {
    if (active.id) updateSgf(active.id, { solved: true })
  }

  async function goNext() {
    let all = await getAllSgfs()
    let siblings = all
      .filter(s => (s.path || '') === (active.path || ''))
      .sort((a, b) => a.filename.localeCompare(b.filename))
    let curIdx = siblings.findIndex(s => s.id === active.id)
    // Find next unsolved after current, wrapping around
    for (let i = 1; i < siblings.length; i++) {
      let s = siblings[(curIdx + i) % siblings.length]
      if (!s.solved) {
        selectSgf({ id: s.id, content: s.content, path: s.path || '' })
        return
      }
    }
    // All solved — go back to library
    clearSgf()
  }

  if (active) {
    return <Quiz key={`${active.id}:${attempt}`} sgf={active.content} onBack={clearSgf} onSolved={markSolved} onNext={goNext} onRetry={() => setAttempt(a => a + 1)} />
  }
  return <Library onSelect={selectSgf} />
}
