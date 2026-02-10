import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { Goban } from '@sabaki/shudan'
import { QuizEngine } from './engine.js'
import { playCorrect, playWrong, playComplete, isSoundEnabled, toggleSound, resetStreak } from './sounds.js'
import { kv, kvSet, kvRemove } from './db.js'

function loadHistory(quizKey) {
  let saved = kv('quizHistory')
  if (!saved) return null
  try {
    let data = JSON.parse(saved)
    return data.key === quizKey ? data.history : null
  } catch { return null }
}

function saveHistory(quizKey, history) {
  kvSet('quizHistory', JSON.stringify({ key: quizKey, history }))
}

function makeEmptyMap(size, fill = null) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

export function Quiz({ sgf, quizKey, filename, dirName, onBack, onSolved, onProgress, onLoadError, onPrev, onNext, onNextUnsolved, onRetry, fileIndex, fileTotal }) {
  let engineRef = useRef(null)
  let historyRef = useRef([])
  let solvedRef = useRef(false)
  let [, forceRender] = useState(0)
  let rerender = () => forceRender(n => n + 1)
  let [peeking, setPeeking] = useState(false)
  let [soundOn, setSoundOn] = useState(isSoundEnabled())
  let [vertexSize, setVertexSize] = useState(0)
  let boardRowRef = useRef(null)
  let [mode, setMode] = useState(() => kv('quizMode', 'liberty'))
  let [maxQ, setMaxQ] = useState(() => parseInt(kv('quizMaxQ', '2')))
  let [error, setError] = useState(null)
  let [showHelp, _setShowHelp] = useState(false)
  let showHelpRef = useRef(false)
  let setShowHelp = (v) => { let next = typeof v === 'function' ? v(showHelpRef.current) : v; showHelpRef.current = next; _setShowHelp(next) }
  let [showDuration, setShowDuration] = useState(() => kv('quizShowDuration', 'manual'))
  let questionStartRef = useRef(null)
  let timesRef = useRef([])
  let [showConfig, _setShowConfig] = useState(false)
  let showConfigRef = useRef(false)
  let setShowConfig = (v) => { let next = typeof v === 'function' ? v(showConfigRef.current) : v; showConfigRef.current = next; _setShowConfig(next) }

  // Initialize engine once (possibly replaying saved history)
  if (!engineRef.current && !error) {
    resetStreak()
    try {
      let saved = loadHistory(quizKey)
      if (saved && saved.length > 0) {
        engineRef.current = QuizEngine.fromReplay(sgf, saved, mode, maxQ)
        historyRef.current = [...saved]
        if (engineRef.current.finished) {
          solvedRef.current = true
          onSolved(engineRef.current.correct, engineRef.current.results.length)
        }
      } else {
        engineRef.current = new QuizEngine(sgf, mode, true, maxQ)
      }
    } catch (e) {
      kvRemove('quizHistory')
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
      if (engine.showingMove) {
        engine.activateQuestions()
        let activated = engine.mode === 'comparison' ? engine.comparisonPair : engine.questionVertex
        if (!activated && !engine.finished) engine.advance()
      } else if (!engine.finished) {
        engine.advance()
      }
      checkFinished()
      rerender()
      return
    }
    let wasRetrying = engine.retrying
    let result = engine.answer(value)
    if (result.correct) {
      if (questionStartRef.current !== null) {
        timesRef.current.push(performance.now() - questionStartRef.current)
        questionStartRef.current = null
      }
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
      if (e.key === 'Escape') { e.preventDefault(); if (showConfigRef.current) setShowConfig(false); else if (showHelpRef.current) setShowHelp(false); else onBack() }
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
        else if (engine.mode === 'comparison' && engine.comparisonPair) submitAnswer(3)
        else if (!hasQuestion) submitAnswer(0)
      }
      else if (engine.mode === 'comparison' && (e.key === '1' || e.key === '2')) submitAnswer(parseInt(e.key))
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

  // Start question timer when a question appears
  useEffect(() => {
    if (!engine) return
    let hasQ = engine.mode === 'comparison' ? engine.comparisonPair : engine.questionVertex
    if (hasQ && questionStartRef.current === null) questionStartRef.current = performance.now()
    if (!hasQ) questionStartRef.current = null
  })

  // Auto-advance after timed show duration
  useEffect(() => {
    if (!engine || !engine.showingMove || showDuration === 'manual') return
    let id = setTimeout(() => submitAnswer(0), parseInt(showDuration))
    return () => clearTimeout(id)
  })

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

  // Show phase: ghost stone for the just-played move (disappears when questions activate)
  if (engine.currentMove && engine.showingMove) {
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
      {engine.finished
        ? <StatsBar engine={engine} times={timesRef.current} />
        : <ProgressBar questionsPerMove={engine.questionsPerMove} moveProgress={engine.moveProgress} />}
      <div class="board-row" ref={boardRowRef}>
        <div
          class="board-container"
          title="Hold to peek at hidden stones (?)"
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

        {engine.finished && <SummaryPanel onRetry={onRetry} onNextUnsolved={onNextUnsolved} />}
      </div>

      <div class="top-bar">
        <button class="bar-btn" title="Back to library (Esc)" onClick={onBack}>☰</button>
        <span class="problem-name">{dirName ? dirName + ' / ' : ''}{engine.gameName || filename?.replace(/\.sgf$/i, '') || 'Untitled'}</span>
        <button class="bar-btn" title="Restart this problem" onClick={onRetry}>↺</button>
        <div class="nav-group">
          <button class="bar-btn" title="Previous problem (←)" onClick={onPrev}>◀</button>
          <button class="bar-btn" title="Next problem (→)" onClick={onNext}>▶</button>
        </div>
        <div class="nav-group">
          <button class="bar-btn" title="Settings (Esc to close)" onClick={() => setShowConfig(c => !c)}>⚙</button>
          <button class="bar-btn" title="Show help" onClick={() => setShowHelp(h => !h)}>?</button>
        </div>
      </div>

      {showConfig && <ConfigPanel
        mode={mode} maxQ={maxQ} soundOn={soundOn} showDuration={showDuration}
        onMode={next => {
          kvSet('quizMode', next)
          setMode(next)
          engine.mode = next
          if (!engine.finished) { engine.recomputeQuestions(); rerender() }
        }}
        onMaxQ={next => {
          kvSet('quizMaxQ', String(next))
          setMaxQ(next)
          engine.maxQuestions = next
          if (!engine.finished) { engine.recomputeQuestions(); rerender() }
        }}
        onSound={() => setSoundOn(toggleSound())}
        onShowDuration={next => {
          kvSet('quizShowDuration', next)
          setShowDuration(next)
        }}
        onClose={() => setShowConfig(false)}
      />}
      {showHelp && <HelpOverlay mode={mode} onClose={() => setShowHelp(false)} />}

      <div class="bottom-bar">
        {(() => {
          if (engine.finished) return <div class="answer-buttons" />
          let hasQuestion = engine.mode === 'comparison' ? engine.comparisonPair : engine.questionVertex
          if (!hasQuestion) return engine.showingMove && showDuration !== 'manual'
            ? <div class="answer-buttons" />
            : <NextButton label={engine.moveIndex === 0 ? 'Start' : 'Next'} onNext={() => submitAnswer(0)} />
          return engine.mode === 'comparison'
            ? <ComparisonButtons onAnswer={submitAnswer} />
            : <AnswerButtons onAnswer={submitAnswer} />
        })()}
      </div>
      </div>
    </div>
  )
}

function iqrFilter(times) {
  if (times.length < 4) return times
  let sorted = [...times].sort((a, b) => a - b)
  let q1 = sorted[Math.floor(sorted.length * 0.25)]
  let q3 = sorted[Math.floor(sorted.length * 0.75)]
  let fence = q3 + 1.5 * (q3 - q1)
  return times.filter(t => t <= fence)
}

function SummaryPanel({ onRetry, onNextUnsolved }) {
  return (
    <div class="summary-panel">
      <div class="scoring-title">Quiz Complete</div>
      <button class="back-btn" title="Restart this problem from the beginning" onClick={onRetry}>Retry</button>
      <button class="back-btn" title="Jump to next unsolved problem (Space)" onClick={onNextUnsolved}>Next Unsolved</button>
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

function StatsBar({ engine, times }) {
  let total = engine.results.length
  let pct = total > 0 ? Math.round(engine.correct / total * 100) : 0
  let filtered = iqrFilter(times)
  let excluded = times.length - filtered.length
  let avg = filtered.length > 0 ? filtered.reduce((a, b) => a + b, 0) / filtered.length : 0
  let sd = filtered.length > 1 ? Math.sqrt(filtered.reduce((a, b) => a + (b - avg) ** 2, 0) / filtered.length) : 0
  return (
    <div class="progress-bar">
      <span class="stats-line">
        {engine.correct}/{total} ({pct}%)
        {filtered.length > 0 && <> &middot; {(avg / 1000).toFixed(1)}s {sd > 0 ? `\u00b1${(sd / 1000).toFixed(1)}s` : ''}{excluded > 0 ? ` (${excluded} slow)` : ''}</>}
      </span>
    </div>
  )
}

function AnswerButtons({ onAnswer }) {
  return (
    <div class="answer-buttons">
      {[1, 2, 3, 4, 5].map(l => (
        <button key={l} class="bar-btn ans-btn" title={`Group has ${l === 5 ? '5 or more' : l} libert${l === 1 ? 'y' : 'ies'} (key ${l})`} onClick={() => onAnswer(l)}>
          {l === 5 ? '5+' : l}
        </button>
      ))}
    </div>
  )
}

function NextButton({ label = 'Next', onNext }) {
  return (
    <div class="answer-buttons">
      <button class="bar-btn next-btn" title={`${label} (Space)`} onClick={onNext}>{label}</button>
    </div>
  )
}

function ComparisonButtons({ onAnswer }) {
  return (
    <div class="answer-buttons">
      <button class="ans-btn black-stone-btn" title="Group 1 has more liberties (key 1)" onClick={() => onAnswer(1)}>1</button>
      <button class="bar-btn ans-btn eq-btn" title="Both groups have equal liberties (Space)" onClick={() => onAnswer(3)}>=</button>
      <button class="ans-btn white-stone-btn" title="Group 2 has more liberties (key 2)" onClick={() => onAnswer(2)}>2</button>
    </div>
  )
}

function ConfigPanel({ mode, maxQ, soundOn, showDuration, onMode, onMaxQ, onSound, onShowDuration, onClose }) {
  return (
    <div class="overlay" onClick={onClose}>
      <div class="overlay-content" onClick={e => e.stopPropagation()}>
        <div class="overlay-header">
          <b>Settings</b>
          <button class="bar-btn" onClick={onClose}>X</button>
        </div>
        <div class="cfg-row">
          <span class="cfg-label">Mode</span>
          <div class="cfg-options">
            <button class={`cfg-opt${mode === 'liberty' ? ' active' : ''}`} onClick={() => onMode('liberty')}>① Liberty</button>
            <button class={`cfg-opt${mode === 'comparison' ? ' active' : ''}`} onClick={() => onMode('comparison')}>⚖ Comparison</button>
          </div>
        </div>
        <div class="cfg-row">
          <span class="cfg-label">Questions</span>
          <div class="cfg-options">
            {[0, 1, 2, 3, 4].map(n => (
              <button key={n} class={`cfg-opt${maxQ === n ? ' active' : ''}`} onClick={() => onMaxQ(n)}>{n}</button>
            ))}
          </div>
        </div>
        <div class="cfg-row">
          <span class="cfg-label">Show move</span>
          <div class="cfg-options">
            {[['manual', 'Until next'], ['1000', '1s'], ['500', '0.5s'], ['200', '0.2s']].map(([val, label]) => (
              <button key={val} class={`cfg-opt${showDuration === val ? ' active' : ''}`} onClick={() => onShowDuration(val)}>{label}</button>
            ))}
          </div>
        </div>
        <div class="cfg-row">
          <span class="cfg-label">Sound</span>
          <div class="cfg-options">
            <button class={`cfg-opt${soundOn ? ' active' : ''}`} onClick={() => { if (!soundOn) onSound() }}>🔊 On</button>
            <button class={`cfg-opt${!soundOn ? ' active' : ''}`} onClick={() => { if (soundOn) onSound() }}>🔇 Off</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HelpOverlay({ mode, onClose }) {
  return (
    <div class="overlay" onClick={onClose}>
      <div class="overlay-content" onClick={e => e.stopPropagation()}>
        <div class="overlay-header">
          <b>Controls</b>
          <button class="bar-btn" onClick={onClose}>X</button>
        </div>
        <table class="help-table">
          <tr><td class="help-key">☰</td><td>Back to library</td><td class="help-shortcut">Esc</td></tr>
          <tr><td class="help-key">↺</td><td>Restart this problem</td><td /></tr>
          <tr><td class="help-key">◀ ▶</td><td>Previous / next problem</td><td class="help-shortcut">← →</td></tr>
          <tr><td class="help-key">⚙</td><td>Open settings (mode, questions, sound)</td><td /></tr>
        </table>
        <div class="help-section">Answering</div>
        <table class="help-table">
          {mode === 'comparison'
            ? <>
                <tr><td class="help-key">1</td><td>Group marked "1" has more liberties</td><td class="help-shortcut">1</td></tr>
                <tr><td class="help-key">=</td><td>Both groups have equal liberties</td><td class="help-shortcut">Space</td></tr>
                <tr><td class="help-key">2</td><td>Group marked "2" has more liberties</td><td class="help-shortcut">2</td></tr>
              </>
            : <>
                <tr><td class="help-key">1-4</td><td>Marked group has that many liberties</td><td class="help-shortcut">1-4</td></tr>
                <tr><td class="help-key">5+</td><td>Marked group has 5 or more liberties</td><td class="help-shortcut">5</td></tr>
              </>
          }
          <tr><td class="help-key">Next</td><td>Advance when no question this move</td><td class="help-shortcut">Space</td></tr>
        </table>
        <div class="help-section">Board</div>
        <table class="help-table">
          <tr><td class="help-key">?</td><td>Hold to peek at hidden stones</td><td class="help-shortcut">? / touch board</td></tr>
        </table>
      </div>
    </div>
  )
}

