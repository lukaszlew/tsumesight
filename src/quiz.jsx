import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { Goban } from '@sabaki/shudan'
import { QuizEngine } from './engine.js'
import { playCorrect, playWrong, playComplete, isSoundEnabled, toggleSound, resetStreak } from './sounds.js'
import { kv, kvSet, kvRemove, getScores, getBestScore } from './db.js'

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

export function Quiz({ sgf, sgfId, quizKey, filename, dirName, onBack, onSolved, onProgress, onLoadError, onPrev, onNext, onNextUnsolved, onRetry, fileIndex, fileTotal }) {
  let engineRef = useRef(null)
  let historyRef = useRef([])
  let solvedRef = useRef(false)
  let [, forceRender] = useState(0)
  let rerender = () => forceRender(n => n + 1)
  let [peeking, setPeeking] = useState(false)
  let [soundOn, setSoundOn] = useState(isSoundEnabled())
  let [vertexSize, setVertexSize] = useState(0)
  let boardRowRef = useRef(null)
  let [mode] = useState(() => kv('quizMode', 'liberty-end'))
  let [maxQ] = useState(() => parseInt(kv('quizMaxQ', '2')))
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
  let [wrongFlash, setWrongFlash] = useState(false)
  let [retryHint, setRetryHint] = useState(false)
  let [introHint, setIntroHint] = useState(false)
  let [modeHint, setModeHint] = useState(false)
  let [settingsHint, setSettingsHint] = useState(false)
  let [markedLiberties, setMarkedLiberties] = useState(new Set())
  let [reviewVertex, setReviewVertex] = useState(null) // vertex key clicked in review
  let markMode = true // TODO: make configurable, hardcoded for now

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
      let total = engine.results.length
      let accuracy = total > 0 ? engine.correct / total : 1
      let { avg } = computeStats(timesRef.current)
      let totalMs = timesRef.current.reduce((a, b) => a + b, 0) + engine.errors * 5000
      let scoreEntry = { accuracy, avgTimeMs: Math.round(avg), totalMs: Math.round(totalMs), errors: engine.errors, date: Date.now(), mode }
      onSolved(engine.correct, total, scoreEntry)
      playComplete()
    }
  }

  let anyHint = retryHint || introHint || modeHint || settingsHint
  let anyHintRef = useRef(false)
  anyHintRef.current = anyHint

  let checkAdvanceHints = () => {
    if (engine.moveIndex >= 5 && !kv('seenSettingsHint')) {
      kvSet('seenSettingsHint', '1')
      setSettingsHint(true)
    }
  }

  let submitAnswer = useCallback((value) => {
    if (anyHintRef.current) return
    if (!engine.questionVertex) {
      if (engine.showingMove) {
        engine.activateQuestions()
        if (engine.moveIndex === 1 && !kv('seenIntroHint')) {
          kvSet('seenIntroHint', '1')
          setIntroHint(true)
        }
        if (!engine.questionVertex && !engine.finished) {
          engine.advance()
          checkAdvanceHints()
        }
      } else if (!engine.finished) {
        engine.advance()
        checkAdvanceHints()
      }
      checkFinished()
      rerender()
      return
    }
    let wasRetrying = engine.retrying
    let result = engine.answer(value)
    if (result.correct) {
      if (questionStartRef.current !== null) {
        let elapsed = performance.now() - questionStartRef.current
        timesRef.current.push(elapsed)
        questionStartRef.current = null
      }
      historyRef.current.push(!wasRetrying)
      saveHistory(quizKey, historyRef.current)
      playCorrect()
      if (result.done) {
        engine.advance()
        checkAdvanceHints()
      }
      let total = engine.questionsPerMove.reduce((a, b) => a + b, 0)
      onProgress({ correct: engine.correct, done: engine.results.length, total })
    } else {
      if (questionStartRef.current !== null) {
        questionStartRef.current = performance.now()
      }
      playWrong()
      setWrongFlash(true)
      setTimeout(() => setWrongFlash(false), 150)
      if (!kv('seenRetryHint')) {
        kvSet('seenRetryHint', '1')
        setRetryHint(true)
      }
    }
    checkFinished()
    rerender()
  }, [])

  let submitMarks = useCallback(() => {
    if (anyHintRef.current) return
    if (!engine.questionVertex) return
    let result = engine.answerMark(markedLiberties)
    if (questionStartRef.current !== null) {
      let elapsed = performance.now() - questionStartRef.current
      timesRef.current.push(elapsed + result.penalties * 3000)
      questionStartRef.current = null
    }
    historyRef.current.push(result.penalties === 0)
    saveHistory(quizKey, historyRef.current)
    if (result.penalties === 0) playCorrect()
    else playWrong()
    setMarkedLiberties(new Set())
    if (result.done) {
      engine.advance()
      checkAdvanceHints()
    }
    let total = engine.questionsPerMove.reduce((a, b) => a + b, 0)
    onProgress({ correct: engine.correct, done: engine.results.length, total })
    checkFinished()
    rerender()
  }, [markedLiberties])

  let onVertexClick = useCallback((evt, vertex) => {
    let key = `${vertex[0]},${vertex[1]}`
    // Review mode: toggle liberty display for clicked question
    if (engine.finished) {
      setReviewVertex(prev => prev === key ? null : key)
      return
    }
    if (!markMode || !engine.questionVertex) return
    // Clicking the questioned group's vertex submits
    let qv = engine.questionVertex
    if (vertex[0] === qv[0] && vertex[1] === qv[1]) { submitMarks(); return }
    // Allow toggling any intersection (user may think a liberty is under a stone)
    setMarkedLiberties(prev => {
      let next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [markMode, submitMarks])

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') { e.preventDefault(); if (anyHintRef.current) { setRetryHint(false); setIntroHint(false); setModeHint(false); setSettingsHint(false) } else if (showConfigRef.current) setShowConfig(false); else if (showHelpRef.current) setShowHelp(false); else onBack() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); onNext() }
      else if (e.key === '?') {
        e.preventDefault()
        setPeeking(true)
      }
      else if (e.key === ' ') {
        e.preventDefault()
        if (!engine.finished && !engine.questionVertex) submitAnswer(0)
      }
      else if (e.key === 'PageUp') { e.preventDefault(); onPrev() }
      else if (e.key === 'PageDown') { e.preventDefault(); onNext() }
      else if (!markMode && e.key >= '1' && e.key <= '5' && !engine.blockedAnswers.has(parseInt(e.key))) submitAnswer(parseInt(e.key))
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

  // Start question timer / clear marks when a question appears
  useEffect(() => {
    if (!engine) return
    if (engine.questionVertex && questionStartRef.current === null) {
      questionStartRef.current = performance.now()
      if (markMode) setMarkedLiberties(new Set())
      if (!kv('seenLibertyHint')) {
        kvSet('seenLibertyHint', '1')
        setModeHint(true)
      }
    }
    if (!engine.questionVertex) questionStartRef.current = null
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
      setVertexSize(Math.max(1, Math.floor(Math.min(width / (cols + 1), height / (rows + 1)))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [cols, rows])

  // Build display maps
  let size = engine.boardSize
  let signMap, markerMap, ghostStoneMap, paintMap

  if (engine.finished) {
    // Show final board with ✓/✗ on questioned groups
    signMap = engine.trueBoard.signMap.map(row => [...row])
    markerMap = makeEmptyMap(size)
    ghostStoneMap = makeEmptyMap(size)
    paintMap = makeEmptyMap(size)

    // Flatten questions and pair with results
    let qByVertex = new Map()
    let ri = 0
    for (let moveQs of engine.questionsAsked)
      for (let q of moveQs) {
        if (q.vertex) qByVertex.set(`${q.vertex[0]},${q.vertex[1]}`, { ...q, correct: engine.results[ri] })
        ri++
      }

    // Place ✓/✗ markers on questioned groups
    for (let [key, q] of qByVertex) {
      let [x, y] = key.split(',').map(Number)
      markerMap[y][x] = { type: 'label', label: q.correct ? '✓' : '✗' }
    }

    // Clicked question: show user's marks (same visual as during play)
    if (reviewVertex && qByVertex.has(reviewVertex)) {
      let q = qByVertex.get(reviewVertex)
      for (let k of (q.marks || [])) {
        let [x, y] = k.split(',').map(Number)
        if (signMap[y][x] === 0) ghostStoneMap[y][x] = { sign: 1, type: 'interesting' }
      }
    }
  } else {
    signMap = engine.getDisplaySignMap()
    markerMap = makeEmptyMap(size)
    ghostStoneMap = makeEmptyMap(size)
    paintMap = makeEmptyMap(size)

    // Show phase: opaque stone with move number for the just-played move
    if (engine.currentMove && engine.showingMove) {
      let [x, y] = engine.currentMove.vertex
      signMap[y][x] = engine.currentMove.sign
      markerMap[y][x] = { type: 'label', label: String(engine.moveIndex) }
      // Show window: also reveal recent previous stones based on wrong-answer count
      for (let { vertex, moveNumber } of engine.getWindowStones()) {
        let [wx, wy] = vertex
        let sign = engine.trueBoard.get(vertex)
        if (sign !== 0) {
          signMap[wy][wx] = sign
          markerMap[wy][wx] = { type: 'label', label: String(moveNumber) }
        }
      }
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
    } else if (engine.questionVertex) {
      let [x, y] = engine.questionVertex
      markerMap[y][x] = { type: 'label', label: '❓' }
      // Show user-marked liberties as ghost stones
      if (markMode) {
        for (let key of markedLiberties) {
          let [mx, my] = key.split(',').map(Number)
          if (signMap[my][mx] === 0) ghostStoneMap[my][mx] = { sign: 1, type: 'interesting' }
        }
      }
    }
  }

  return (
    <div class="quiz">
      <div class="board-row" ref={boardRowRef}>
        <div
          class={`board-container${wrongFlash ? ' wrong-flash' : ''}`}
          title="Hold to peek at hidden stones (?)"
          onPointerDown={() => { if (!markMode || !engine.questionVertex) setPeeking(true) }}
          onPointerUp={() => setPeeking(false)}
          onPointerLeave={() => setPeeking(false)}
        >
          {vertexSize > 0 && <Goban
            vertexSize={vertexSize}
            signMap={signMap}
            markerMap={markerMap}
            ghostStoneMap={ghostStoneMap}
            paintMap={paintMap}
            onVertexClick={markMode || engine.finished ? onVertexClick : undefined}
            rangeX={rangeX}
            rangeY={rangeY}
            showCoordinates={false}
            fuzzyStonePlacement={false}
            animateStonePlacement={false}
          />}
        </div>

        {engine.finished && <SummaryPanel onRetry={onRetry} onNextUnsolved={onNextUnsolved} />}
      </div>

      <div class="problem-name">
        {dirName && <span class="problem-dir">{dirName}</span>}
        <span class="problem-file">{engine.gameName || filename?.replace(/\.sgf$/i, '') || 'Untitled'}</span>
      </div>

      <div class="toolbar">
        <button class="bar-btn" title="Back to library (Esc)" onClick={onBack}>☰</button>
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

      <div class="bottom-bar">
        {(() => {
          if (engine.finished) return <StatsBar engine={engine} times={timesRef.current} sgfId={sgfId} />
          if (engine.moveIndex === 0) return <ModeChoice onStart={() => submitAnswer(0)} />
          if (markMode) return engine.questionVertex
            ? null
            : <NextButton label="Next" onNext={() => submitAnswer(0)} />
          if (!engine.questionVertex) return engine.showingMove && showDuration !== 'manual'
            ? <div class="answer-buttons" />
            : <NextButton label="Next" onNext={() => submitAnswer(0)} />
          return <AnswerButtons onAnswer={submitAnswer} blocked={engine.blockedAnswers} />
        })()}
      </div>

      {showConfig && <ConfigPanel
        soundOn={soundOn} showDuration={showDuration}
        onSound={() => setSoundOn(toggleSound())}
        onShowDuration={next => {
          kvSet('quizShowDuration', next)
          setShowDuration(next)
        }}
        onClose={() => setShowConfig(false)}
      />}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}

      {settingsHint && <div class="overlay">
        <div class="overlay-content">
          <div class="overlay-header">
            <b>Tip</b>
            <button class="bar-btn" onClick={() => setSettingsHint(false)}>X</button>
          </div>
          <p>Press &#x2699; to adjust settings — enable timed auto-advance so stones disappear automatically.</p>
        </div>
      </div>}
      {modeHint && <div class="overlay">
        <div class="overlay-content">
          <div class="overlay-header">
            <b>Liberty mode</b>
            <button class="bar-btn" onClick={() => setModeHint(false)}>X</button>
          </div>
          <p>A group is marked with &#x2753;. Count its liberties and pick the right number (1–4 or 5+).</p>
        </div>
      </div>}
      {introHint && <div class="overlay">
        <div class="overlay-content">
          <div class="overlay-header">
            <b>How it works</b>
            <button class="bar-btn" onClick={() => setIntroHint(false)}>X</button>
          </div>
          <p>This stone will disappear. Stones are shown one at a time — remember their positions and answer questions about the board between moves.</p>
        </div>
      </div>}
      {retryHint && <div class="overlay">
        <div class="overlay-content">
          <div class="overlay-header">
            <b>Hint</b>
            <button class="bar-btn" onClick={() => setRetryHint(false)}>X</button>
          </div>
          <p>Wrong answer — that choice is now blocked. Pick a different answer. Each error adds a 5s penalty.</p>
        </div>
      </div>}
    </div>
  )
}


function SummaryPanel({ onRetry, onNextUnsolved }) {
  return (
    <div class="summary-panel">
      <div class="scoring-title">Quiz Complete</div>
      <button class="back-btn" title="Restart this problem from the beginning" onClick={onRetry}>Retry</button>
      <button class="back-btn" title="Jump to next unsolved problem" onClick={onNextUnsolved}>Next Unsolved</button>
    </div>
  )
}


export function computeStats(times, cap = 5000) {
  let capped = times.map(t => Math.min(t, cap))
  let avg = capped.length > 0 ? capped.reduce((a, b) => a + b, 0) / capped.length : 0
  let sd = capped.length > 1 ? Math.sqrt(capped.reduce((a, b) => a + (b - avg) ** 2, 0) / capped.length) : 0
  return { avg, sd }
}

function StatsBar({ engine, times, sgfId }) {
  let totalMs = times.reduce((a, b) => a + b, 0) + engine.errors * 5000
  let totalSec = (totalMs / 1000).toFixed(1)
  let scores = sgfId ? getScores(sgfId) : []
  let best = scores.length > 0 ? scores.reduce((b, s) =>
    (s.totalMs || Infinity) < (b.totalMs || Infinity) ? s : b
  ) : null
  return (
    <div class="stats-expanded">
      <div class="stats-grid">
        <span class="stats-cell">{totalSec}s{engine.errors > 0 ? ` (${engine.errors} err +${engine.errors * 5}s)` : ''}</span>
        {best && best.totalMs && <span class="stats-cell stats-best">Best: {(best.totalMs / 1000).toFixed(1)}s</span>}
        {scores.length > 0 && <span class="stats-cell stats-runs">Run #{scores.length + 1}</span>}
      </div>
    </div>
  )
}

function AnswerButtons({ onAnswer, blocked }) {
  return (
    <div class="answer-buttons">
      {[1, 2, 3, 4, 5].map(l => (
        <button key={l} class={`bar-btn ans-btn${blocked.has(l) ? ' btn-blocked' : ''}`} disabled={blocked.has(l)} title={`Group has ${l === 5 ? '5 or more' : l} libert${l === 1 ? 'y' : 'ies'} (key ${l})`} onClick={() => onAnswer(l)}>
          {l === 5 ? '5+' : l}
        </button>
      ))}
    </div>
  )
}

function ModeChoice({ onStart }) {
  return (
    <div class="mode-choice">
      <button class="bar-btn next-btn" title="Start (Space)" onClick={onStart}>Start</button>
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

function ConfigPanel({ soundOn, showDuration, onSound, onShowDuration, onClose }) {
  return (
    <div class="overlay" onClick={onClose}>
      <div class="overlay-content" onClick={e => e.stopPropagation()}>
        <div class="overlay-header">
          <b>Settings</b>
          <button class="bar-btn" onClick={onClose}>X</button>
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

function HelpOverlay({ onClose }) {
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
          <tr><td class="help-key">⚙</td><td>Open settings</td><td /></tr>
        </table>
        <div class="help-section">Answering</div>
        <table class="help-table">
          <tr><td class="help-key">1-4</td><td>Marked group has that many liberties</td><td class="help-shortcut">1-4</td></tr>
          <tr><td class="help-key">5+</td><td>Marked group has 5 or more liberties</td><td class="help-shortcut">5</td></tr>
          <tr><td class="help-key">Next</td><td>Advance when no question this move</td><td class="help-shortcut">Space</td></tr>
        </table>
        <div class="help-section">Board</div>
        <table class="help-table">
          <tr><td class="help-key">?</td><td>Hold to reveal hidden stones</td><td class="help-shortcut">? / hold board</td></tr>
        </table>
      </div>
    </div>
  )
}
