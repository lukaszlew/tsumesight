import { useState } from 'preact/hooks'
import { Library } from './library.jsx'
import { Quiz } from './quiz.jsx'

export function App() {
  const [activeSgf, setActiveSgf] = useState(null)

  if (activeSgf) {
    return <Quiz sgf={activeSgf} onBack={() => setActiveSgf(null)} />
  }
  return <Library onSelect={setActiveSgf} />
}
