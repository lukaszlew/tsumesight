import { useState } from 'preact/hooks'
import { Library } from './library.jsx'
import { Quiz } from './quiz.jsx'

export function App() {
  const [activeSgf, setActiveSgf] = useState(() => sessionStorage.getItem('activeSgf'))

  function selectSgf(sgf) {
    sessionStorage.setItem('activeSgf', sgf)
    setActiveSgf(sgf)
  }

  function clearSgf() {
    sessionStorage.removeItem('activeSgf')
    setActiveSgf(null)
  }

  if (activeSgf) {
    return <Quiz sgf={activeSgf} onBack={clearSgf} />
  }
  return <Library onSelect={selectSgf} />
}
