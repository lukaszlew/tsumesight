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

  async function getSiblings() {
    let all = await getAllSgfs()
    return all
      .filter(s => (s.path || '') === (active.path || ''))
      .sort((a, b) => a.filename.localeCompare(b.filename))
  }

  async function goStep(delta) {
    let siblings = await getSiblings()
    let curIdx = siblings.findIndex(s => s.id === active.id)
    let s = siblings[(curIdx + delta + siblings.length) % siblings.length]
    if (s) selectSgf({ id: s.id, content: s.content, path: s.path || '' })
  }

  async function goNextUnsolved() {
    let siblings = await getSiblings()
    let curIdx = siblings.findIndex(s => s.id === active.id)
    for (let i = 1; i < siblings.length; i++) {
      let s = siblings[(curIdx + i) % siblings.length]
      if (!s.solved) {
        selectSgf({ id: s.id, content: s.content, path: s.path || '' })
        return
      }
    }
    clearSgf()
  }

  if (active) {
    return <Quiz key={`${active.id}:${attempt}`} sgf={active.content}
      onBack={clearSgf} onSolved={markSolved}
      onPrev={() => goStep(-1)} onNext={() => goStep(1)}
      onNextUnsolved={goNextUnsolved}
      onRetry={() => setAttempt(a => a + 1)} />
  }
  return <Library onSelect={selectSgf} />
}
