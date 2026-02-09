import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { BoundedGoban } from '@sabaki/shudan'
import { QuizEngine } from './engine.js'
import { playCorrect, playWrong, playComplete, isSoundEnabled, toggleSound } from './sounds.js'

function makeEmptyMap(size, fill = null) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

export function Quiz({ sgf, onBack, onSolved, onPrev, onNext, onNextUnsolved, onRetry, fileIndex, fileTotal }) {
  let engineRef = useRef(null)
  let [, forceRender] = useState(0)
  let rerender = () => forceRender(n => n + 1)
  let [peeking, setPeeking] = useState(false)
  let [soundOn, setSoundOn] = useState(isSoundEnabled())
  let [error, setError] = useState(null)

  // Initialize engine once
  if (!engineRef.current && !error) {
    try {
      engineRef.current = new QuizEngine(sgf)
      engineRef.current.advance()
    } catch (e) {
      setError(e.message)
    }
  }
  let engine = engineRef.current

  if (error) {
    return (
      <div class="quiz">
        <div class="summary-overlay">
          <h2>Cannot load SGF</h2>
          <p>{error}</p>
          <button class="back-btn" onClick={onBack}>Back to Library</button>
        </div>
      </div>
    )
  }

  let solvedRef = useRef(false)

  let checkFinished = () => {
    if (engine.finished && !solvedRef.current) {
      solvedRef.current = true
      onSolved()
      playComplete()
    }
  }

  let submitAnswer = useCallback((liberties) => {
    if (!engine.questionVertex) return
    let result = engine.answer(liberties)
    if (result.correct) {
      playCorrect()
      if (result.done) engine.advance()
    } else {
      playWrong()
    }
    checkFinished()
    rerender()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); onNext() }
      else if (e.key === ' ') {
        e.preventDefault()
        if (engine.finished) onNextUnsolved()
        else setPeeking(true)
      }
      else if (e.key >= '1' && e.key <= '5') submitAnswer(parseInt(e.key))
    }
    function onKeyUp(e) {
      if (e.key === ' ') setPeeking(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [submitAnswer])

  // Build display maps
  let size = engine.boardSize
  let signMap = engine.finished ? engine.trueBoard.signMap : engine.getDisplaySignMap()
  let markerMap = makeEmptyMap(size)
  let ghostStoneMap = makeEmptyMap(size)

  // Current move: ghost stone (semi-transparent last move indicator)
  if (engine.currentMove) {
    let [x, y] = engine.currentMove.vertex
    ghostStoneMap[y][x] = { sign: engine.currentMove.sign, faint: true }
  }

  if (peeking) {
    // Show invisible stones as ghost stones
    for (let [, { vertex }] of engine.invisibleStones) {
      let [x, y] = vertex
      let sign = engine.trueBoard.get(vertex)
      if (sign !== 0) ghostStoneMap[y][x] = { sign, faint: true }
    }
  } else {
    // Show all pending question vertices
    if (engine.questionVertex) {
      let [x, y] = engine.questionVertex
      markerMap[y][x] = { type: 'label', label: '❓' }
    }
  }

  return (
    <div class="quiz">
      <div class="board-section">
      <div class="top-bar">
        <button class="bar-btn" onClick={onBack}>☰</button>
        <div class="nav-group">
          <button class="bar-btn" onClick={onPrev}>◀</button>
          {fileTotal && <span class="file-counter">{fileIndex}/{fileTotal}</span>}
          <button class="bar-btn" onClick={onNext}>▶</button>
        </div>
        <button class="bar-btn" onClick={() => setSoundOn(toggleSound())}>
          {soundOn ? '🔊' : '🔇'}
        </button>
      </div>
      <div class="board-row">
        <div
          class="board-container"
          onPointerDown={() => setPeeking(true)}
          onPointerUp={() => setPeeking(false)}
          onPointerLeave={() => setPeeking(false)}
        >
          <BoundedGoban
            maxWidth={560}
            maxHeight={560}
            signMap={signMap}
            markerMap={markerMap}
            ghostStoneMap={ghostStoneMap}
            rangeX={engine.boardRange && [engine.boardRange[0], engine.boardRange[2]]}
            rangeY={engine.boardRange && [engine.boardRange[1], engine.boardRange[3]]}
            showCoordinates={false}
            fuzzyStonePlacement={false}
            animateStonePlacement={false}
          />
        </div>

        {engine.finished && <SummaryPanel engine={engine} onBack={onBack} onRetry={onRetry} onNextUnsolved={onNextUnsolved} />}
      </div>

      <div class="bottom-bar">
        <ProgressBar questionsPerMove={engine.questionsPerMove} moveProgress={engine.moveProgress} />
        {!engine.finished && <AnswerButtons onLiberties={submitAnswer} />}
      </div>
      </div>
    </div>
  )
}

function SummaryPanel({ engine, onBack, onRetry, onNextUnsolved }) {
  let total = engine.results.length
  let pct = total > 0 ? Math.round(engine.correct / total * 100) : 0
  return (
    <div class="summary-panel">
      <div class="scoring-title">Quiz Complete</div>
      <div>Moves: {total}</div>
      <div class="summary-correct">Correct: {engine.correct}</div>
      <div class="summary-wrong">Wrong: {engine.wrong}</div>
      <div>Accuracy: {pct}%</div>
      <hr />
      <button class="back-btn" onClick={onBack}>Back</button>
      <button class="back-btn" onClick={onRetry}>Retry</button>
      <button class="back-btn" onClick={onNextUnsolved}>Next Unsolved</button>
    </div>
  )
}

function ProgressBar({ questionsPerMove, moveProgress }) {
  let ref = useRef(null)
  let played = moveProgress.length

  useEffect(() => {
    if (!ref.current || played === 0) return
    let col = ref.current.children[played - 1]
    if (col) col.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  })

  return (
    <div class="progress-bar" ref={ref}>
      {questionsPerMove.map((total, i) => {
        let results = moveProgress[i] ? moveProgress[i].results : []
        return (
          <div key={i} class={`progress-move${i === played - 1 ? ' current' : ''}`}>
            {Array.from({ length: total }, (_, j) => (
              <span key={j} class={results[j] === 'correct' ? 'check-done' : results[j] === 'failed' ? 'check-fail' : 'check-empty'} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function AnswerButtons({ onLiberties }) {
  return (
    <div class="answer-buttons">
      {[1, 2, 3, 4, 5].map(l => (
        <button key={l} class="bar-btn ans-btn" onClick={() => onLiberties(l)}>
          {l === 5 ? '5+' : l}
        </button>
      ))}
    </div>
  )
}

