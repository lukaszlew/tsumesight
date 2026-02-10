import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { Goban } from '@sabaki/shudan'
import { QuizEngine } from './engine.js'
import { playCorrect, playWrong, playComplete, isSoundEnabled, toggleSound, resetStreak } from './sounds.js'

const HISTORY_KEY = 'quizHistory'
const MODE_KEY = 'quizMode'

function getMode() {
  return localStorage.getItem(MODE_KEY) || 'comparison'
}

function loadHistory(quizKey) {
  let saved = sessionStorage.getItem(HISTORY_KEY)
  if (!saved) return null
  try {
    let data = JSON.parse(saved)
    return data.key === quizKey ? data.history : null
  } catch { return null }
}

function saveHistory(quizKey, history) {
  sessionStorage.setItem(HISTORY_KEY, JSON.stringify({ key: quizKey, history }))
}

function makeEmptyMap(size, fill = null) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

export function Quiz({ sgf, quizKey, onBack, onSolved, onProgress, onLoadError, onPrev, onNext, onNextUnsolved, onRetry, fileIndex, fileTotal }) {
  let engineRef = useRef(null)
  let historyRef = useRef([])
  let solvedRef = useRef(false)
  let [, forceRender] = useState(0)
  let rerender = () => forceRender(n => n + 1)
  let [peeking, setPeeking] = useState(false)
  let [soundOn, setSoundOn] = useState(isSoundEnabled())
  let [vertexSize, setVertexSize] = useState(0)
  let boardRowRef = useRef(null)
  let [mode, setMode] = useState(getMode)
  let [error, setError] = useState(null)

  // Initialize engine once (possibly replaying saved history)
  if (!engineRef.current && !error) {
    resetStreak()
    try {
      let saved = loadHistory(quizKey)
      if (saved && saved.length > 0) {
        engineRef.current = QuizEngine.fromReplay(sgf, saved, mode)
        historyRef.current = [...saved]
        if (engineRef.current.finished) {
          solvedRef.current = true
          onSolved(engineRef.current.correct, engineRef.current.results.length)
        }
      } else {
        engineRef.current = new QuizEngine(sgf, mode)
        engineRef.current.advance()
      }
    } catch (e) {
      sessionStorage.removeItem(HISTORY_KEY)
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

  let checkFinished = () => {
    if (engine.finished && !solvedRef.current) {
      solvedRef.current = true
      onSolved(engine.correct, engine.results.length)
      playComplete()
    }
  }

  let submitAnswer = useCallback((value) => {
    let hasQuestion = engine.mode === 'comparison' ? engine.comparisonPair : engine.questionVertex
    if (!hasQuestion) {
      // No question this move (e.g. 0 comparison pairs) — any press advances
      if (!engine.finished) engine.advance()
      checkFinished()
      rerender()
      return
    }
    let wasRetrying = engine.retrying
    let result = engine.answer(value)
    if (result.correct) {
      historyRef.current.push(!wasRetrying)
      saveHistory(quizKey, historyRef.current)
      playCorrect()
      if (result.done) engine.advance()
      let total = engine.questionsPerMove.reduce((a, b) => a + b, 0)
      onProgress({ correct: engine.correct, done: engine.results.length, total })
    } else {
      playWrong()
    }
    checkFinished()
    rerender()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') { e.preventDefault(); onBack() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); onNext() }
      else if (e.key === '?') {
        e.preventDefault()
        setPeeking(true)
      }
      else if (e.key === ' ') {
        e.preventDefault()
        let hasQuestion = engine.mode === 'comparison' ? engine.comparisonPair : engine.questionVertex
        if (engine.finished) onNextUnsolved()
        else if (!hasQuestion) submitAnswer(0)
      }
      else if (engine.mode === 'comparison' && (e.key === '1' || e.key === '2')) submitAnswer(parseInt(e.key))
      else if (engine.mode === 'comparison' && (e.key === 'q' || e.key === 'Q')) submitAnswer(3)
      else if (engine.mode !== 'comparison' && e.key >= '1' && e.key <= '5') submitAnswer(parseInt(e.key))
    }
    function onKeyUp(e) {
      if (e.key === '?') setPeeking(false)
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
  // Measure actual board-row container via ResizeObserver — no viewport guessing
  useEffect(() => {
    let el = boardRowRef.current
    if (!el) return
    let ro = new ResizeObserver(entries => {
      let { width, height } = entries[0].contentRect
      setVertexSize(Math.max(1, Math.floor(Math.min(width / (cols + 1.8), height / (rows + 1.8)))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [cols, rows])

  // Build display maps
  let size = engine.boardSize
  let signMap = engine.finished ? engine.trueBoard.signMap : engine.getDisplaySignMap()
  let markerMap = makeEmptyMap(size)
  let ghostStoneMap = makeEmptyMap(size)

  // Current move: ghost stone (semi-transparent last move indicator)
  // Clear signMap at ghost vertex so stale captured stones don't show through
  if (engine.currentMove) {
    let [x, y] = engine.currentMove.vertex
    signMap[y][x] = 0
    ghostStoneMap[y][x] = { sign: engine.currentMove.sign, faint: true }
  }

  if (peeking) {
    // Show invisible stones as ghost stones
    for (let [, { vertex }] of engine.invisibleStones) {
      let [x, y] = vertex
      let sign = engine.trueBoard.get(vertex)
      if (sign !== 0) {
        signMap[y][x] = 0
        ghostStoneMap[y][x] = { sign, faint: true }
      }
    }
  } else if (engine.mode === 'comparison' && engine.comparisonPair) {
    let { v1, v2 } = engine.comparisonPair
    let [x1, y1] = v1
    let [x2, y2] = v2
    markerMap[y1][x1] = { type: 'label', label: '1' }
    markerMap[y2][x2] = { type: 'label', label: '2' }
  } else if (engine.questionVertex) {
    let [x, y] = engine.questionVertex
    markerMap[y][x] = { type: 'label', label: '❓' }
  }

  return (
    <div class="quiz">
      <div class="board-section">
      <ProgressBar questionsPerMove={engine.questionsPerMove} moveProgress={engine.moveProgress} />
      <div class="board-row" ref={boardRowRef}>
        <div
          class="board-container"
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

      <div class="top-bar">
        <button class="bar-btn" onClick={onBack}>☰</button>
        <button class="bar-btn" onClick={onRetry}>↺</button>
        <div class="nav-group">
          <button class="bar-btn" onClick={onPrev}>◀</button>
          <button class="bar-btn" onClick={onNext}>▶</button>
        </div>
        <div class="nav-group">
          <button class="bar-btn" onClick={() => {
            let next = mode === 'liberty' ? 'comparison' : 'liberty'
            localStorage.setItem(MODE_KEY, next)
            setMode(next)
            engine.mode = next
            if (!engine.finished) {
              engine.recomputeQuestions()
              rerender()
            }
          }}>
            {mode === 'liberty' ? '①' : '⚖'}
          </button>
          <button class="bar-btn" onClick={() => setSoundOn(toggleSound())}>
            {soundOn ? '🔊' : '🔇'}
          </button>
        </div>
      </div>

      <div class="bottom-bar">
        {(() => {
          if (engine.finished) return <div class="answer-buttons" />
          let hasQuestion = engine.mode === 'comparison' ? engine.comparisonPair : engine.questionVertex
          if (!hasQuestion) return <NextButton onNext={() => submitAnswer(0)} />
          return engine.mode === 'comparison'
            ? <ComparisonButtons onAnswer={submitAnswer} />
            : <AnswerButtons onAnswer={submitAnswer} />
        })()}
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

  let correctCount = moveProgress.reduce((sum, mp) => sum + mp.results.filter(r => r === 'correct').length, 0)
  let totalCount = questionsPerMove.reduce((sum, q) => sum + q, 0)

  return (
    <div class="progress-bar">
      <span class="progress-score"><span class="score-correct">{correctCount}</span><span class="score-slash">/{totalCount}</span></span>
      <div class="progress-pips">
        <span class={`progress-ellipsis${needsWindow && start > 0 ? '' : ' invisible'}`}>…</span>
        {questionsPerMove.slice(start, end).map((qCount, offset) => {
          let i = start + offset
          let results = moveProgress[i] ? moveProgress[i].results : []
          return (
            <div key={i} class={`progress-move${i === current ? ' current' : ''}`}>
              <span class="move-number">{i === current ? i + 1 : ''}</span>
              {qCount === 0
                ? <span class="check-skip" />
                : Array.from({ length: qCount }, (_, j) => (
                  <span key={j} class={results[j] === 'correct' ? 'check-done' : results[j] === 'failed' ? 'check-fail' : 'check-empty'} />
                ))}
            </div>
          )
        })}
        <span class={`progress-ellipsis${needsWindow && end < total ? '' : ' invisible'}`}>…</span>
      </div>
    </div>
  )
}

function AnswerButtons({ onAnswer }) {
  return (
    <div class="answer-buttons">
      {[1, 2, 3, 4, 5].map(l => (
        <button key={l} class="bar-btn ans-btn" onClick={() => onAnswer(l)}>
          {l === 5 ? '5+' : l}
        </button>
      ))}
    </div>
  )
}

function NextButton({ onNext }) {
  return (
    <div class="answer-buttons">
      <button class="bar-btn next-btn" onClick={onNext}>Next</button>
    </div>
  )
}

function ComparisonButtons({ onAnswer }) {
  return (
    <div class="answer-buttons">
      <button class="ans-btn black-stone-btn" onClick={() => onAnswer(1)}>1</button>
      <button class="bar-btn ans-btn eq-btn" onClick={() => onAnswer(3)}>=</button>
      <button class="ans-btn white-stone-btn" onClick={() => onAnswer(2)}>2</button>
    </div>
  )
}

