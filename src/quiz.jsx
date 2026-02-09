import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { Goban } from '@sabaki/shudan'
import { QuizEngine } from './engine.js'
import { playCorrect, playWrong, playComplete, isSoundEnabled, toggleSound } from './sounds.js'

function makeEmptyMap(size, fill = null) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

export function Quiz({ sgf, onBack, onSolved, onLoadError, onPrev, onNext, onNextUnsolved, onRetry, fileIndex, fileTotal }) {
  let engineRef = useRef(null)
  let [, forceRender] = useState(0)
  let rerender = () => forceRender(n => n + 1)
  let [peeking, setPeeking] = useState(false)
  let [soundOn, setSoundOn] = useState(isSoundEnabled())
  let [vertexSize, setVertexSize] = useState(0)
  let boardContainerRef = useRef(null)
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
          <button class="back-btn" onClick={onLoadError || onBack}>Back to Library</button>
        </div>
      </div>
    )
  }

  let solvedRef = useRef(false)

  let checkFinished = () => {
    if (engine.finished && !solvedRef.current) {
      solvedRef.current = true
      onSolved(engine.correct, engine.results.length)
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

  // Compute vertex size from container
  let rangeX = engine.boardRange ? [engine.boardRange[0], engine.boardRange[2]] : undefined
  let rangeY = engine.boardRange ? [engine.boardRange[1], engine.boardRange[3]] : undefined
  let cols = rangeX ? rangeX[1] - rangeX[0] + 1 : engine.boardSize
  let rows = rangeY ? rangeY[1] - rangeY[0] + 1 : engine.boardSize
  useEffect(() => {
    let el = boardContainerRef.current
    if (!el) return
    let maxW = Math.min(560, el.offsetWidth)
    let maxH = 560
    setVertexSize(Math.max(1, Math.floor(Math.min(maxW / (cols + 1), maxH / (rows + 1)))))
  }, [cols, rows])

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
          ref={boardContainerRef}
          onPointerDown={() => setPeeking(true)}
          onPointerUp={() => setPeeking(false)}
          onPointerLeave={() => setPeeking(false)}
        >
          {vertexSize > 0 && <Goban
            vertexSize={vertexSize}
            signMap={signMap}
            markerMap={markerMap}
            ghostStoneMap={ghostStoneMap}
            rangeX={rangeX}
            rangeY={rangeY}
            showCoordinates={false}
            fuzzyStonePlacement={false}
            animateStonePlacement={false}
          />}
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
      <button class="back-btn" onClick={onRetry}>Retry</button>
      <button class="back-btn" onClick={onNextUnsolved}>Next Unsolved</button>
    </div>
  )
}

function ProgressBar({ questionsPerMove, moveProgress }) {
  let total = questionsPerMove.length
  let current = moveProgress.length - 1
  let CONTEXT = 3
  let needsWindow = total > CONTEXT * 2 + 1
  let start = needsWindow ? Math.max(0, Math.min(current - CONTEXT, total - CONTEXT * 2 - 1)) : 0
  let end = needsWindow ? Math.min(total, start + CONTEXT * 2 + 1) : total

  return (
    <div class="progress-bar">
      {needsWindow && start > 0 && <span class="progress-ellipsis">…</span>}
      {questionsPerMove.slice(start, end).map((qCount, offset) => {
        let i = start + offset
        let results = moveProgress[i] ? moveProgress[i].results : []
        return (
          <div key={i} class={`progress-move${i === current ? ' current' : ''}`}>
            {Array.from({ length: qCount }, (_, j) => (
              <span key={j} class={results[j] === 'correct' ? 'check-done' : results[j] === 'failed' ? 'check-fail' : 'check-empty'} />
            ))}
          </div>
        )
      })}
      {needsWindow && end < total && <span class="progress-ellipsis">…</span>}
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

