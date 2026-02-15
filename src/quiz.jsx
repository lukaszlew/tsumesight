import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { Goban } from '@sabaki/shudan'
import Board from '@sabaki/go-board'
import { QuizEngine } from './engine.js'
import { parseSgf } from './sgf-utils.js'
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
  let [reviewStep, setReviewStep] = useState(null) // null = not reviewing
  let totalReviewStepsRef = useRef(0)

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

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') { e.preventDefault(); if (anyHintRef.current) { setRetryHint(false); setIntroHint(false); setModeHint(false); setSettingsHint(false) } else if (showConfigRef.current) setShowConfig(false); else if (showHelpRef.current) setShowHelp(false); else onBack() }
      else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (e.shiftKey) onPrev()
        else if (engine.finished) setReviewStep(s => s === null ? totalReviewStepsRef.current : s > 0 ? s - 1 : totalReviewStepsRef.current)
      }
      else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (e.shiftKey) onNext()
        else if (engine.finished) setReviewStep(s => s === null ? 1 : s < totalReviewStepsRef.current ? s + 1 : 0)
      }
      else if (e.key === '?') {
        e.preventDefault()
        setPeeking(true)
      }
      else if (e.key === ' ') {
        e.preventDefault()
        if (engine.finished) setReviewStep(s => s === null ? 1 : s < totalReviewStepsRef.current ? s + 1 : 0)
        else if (!engine.questionVertex) submitAnswer(0)
      }
      else if (e.key === 'PageUp') { e.preventDefault(); onPrev() }
      else if (e.key === 'PageDown') { e.preventDefault(); onNext() }
      else if (e.key >= '1' && e.key <= '5' && !engine.blockedAnswers.has(parseInt(e.key))) submitAnswer(parseInt(e.key))
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
    if (engine.questionVertex && questionStartRef.current === null) {
      questionStartRef.current = performance.now()
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

  // Compute total review steps: 1 per stone + 1 per question
  totalReviewStepsRef.current = 0
  if (engine.finished) {
    for (let i = 0; i < engine.totalMoves; i++)
      totalReviewStepsRef.current += 1 + (engine.questionsAsked[i]?.length || 0)
  }

  // Build display maps
  let size = engine.boardSize
  let signMap, markerMap, ghostStoneMap

  if (engine.finished && reviewStep !== null) {
    // Review mode: decode reviewStep into movesShown + questionsShown
    let parsed = parseSgf(sgf)
    let reviewBoard = Board.fromDimensions(size)
    for (let [x, y] of parsed.setupBlack) reviewBoard.set([x, y], 1)
    for (let [x, y] of parsed.setupWhite) reviewBoard.set([x, y], -1)
    let moves = parsed.moves.filter(m => m.vertex != null)
    markerMap = makeEmptyMap(size)
    ghostStoneMap = makeEmptyMap(size)

    let movesShown = 0, questionsShown = 0, remaining = reviewStep
    for (let i = 0; i < engine.totalMoves && remaining > 0; i++) {
      remaining--
      movesShown = i + 1
      questionsShown = 0
      let qCount = engine.questionsAsked[i]?.length || 0
      let showQ = Math.min(remaining, qCount)
      questionsShown = showQ
      remaining -= showQ
    }

    for (let i = 0; i < movesShown && i < moves.length; i++) {
      try { reviewBoard = reviewBoard.makeMove(moves[i].sign, moves[i].vertex) } catch { break }
      let [x, y] = moves[i].vertex
      if (reviewBoard.get(moves[i].vertex) !== 0)
        markerMap[y][x] = { type: 'label', label: String(i + 1) }
    }
    // Show question markers for the current move's revealed questions
    if (movesShown > 0 && questionsShown > 0) {
      let asked = engine.questionsAsked[movesShown - 1]
      if (asked) for (let j = 0; j < questionsShown && j < asked.length; j++) {
        let q = asked[j]
        if (q.vertex) {
          let [x, y] = q.vertex
          if (reviewBoard.get(q.vertex) !== 0) markerMap[y][x] = { type: 'label', label: '❓' }
        }
      }
    }
    signMap = reviewBoard.signMap
  } else {
    signMap = engine.finished ? engine.trueBoard.signMap : engine.getDisplaySignMap()
    markerMap = makeEmptyMap(size)
    ghostStoneMap = makeEmptyMap(size)

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
    }

    // When finished but not reviewing, show all move numbers
    if (engine.finished && reviewStep === null) {
      let parsed = parseSgf(sgf)
      let checkBoard = Board.fromDimensions(size)
      for (let [x, y] of parsed.setupBlack) checkBoard.set([x, y], 1)
      for (let [x, y] of parsed.setupWhite) checkBoard.set([x, y], -1)
      let moves = parsed.moves.filter(m => m.vertex != null)
      for (let i = 0; i < moves.length; i++) {
        try { checkBoard = checkBoard.makeMove(moves[i].sign, moves[i].vertex) } catch { break }
        let [x, y] = moves[i].vertex
        if (checkBoard.get(moves[i].vertex) !== 0) {
          markerMap[y][x] = { type: 'label', label: String(i + 1) }
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

        {engine.finished && <SummaryPanel onRetry={onRetry} onNextUnsolved={onNextUnsolved}
          reviewStep={reviewStep} totalSteps={totalReviewStepsRef.current}
          onReviewBack={() => setReviewStep(s => s === null ? totalReviewStepsRef.current : s > 0 ? s - 1 : totalReviewStepsRef.current)}
          onReviewForward={() => setReviewStep(s => s === null ? 1 : s < totalReviewStepsRef.current ? s + 1 : 0)} />}
      </div>

      <div class="problem-name">
        {dirName && <span class="problem-dir">{dirName}</span>}
        <span class="problem-file">{engine.gameName || filename?.replace(/\.sgf$/i, '') || 'Untitled'}</span>
      </div>

      <div class="toolbar">
        <button class="bar-btn" title="Back to library (Esc)" onClick={onBack}>☰</button>
        <button class="bar-btn" title="Restart this problem" onClick={onRetry}>↺</button>
        <div class="nav-group">
          <button class={`bar-btn${!engine.finished ? ' btn-inactive' : ''}`} title="Review step back (←)" onClick={() => setReviewStep(s => s === null ? totalReviewStepsRef.current : s > 0 ? s - 1 : totalReviewStepsRef.current)}>⏪</button>
          <button class={`bar-btn${!engine.finished ? ' btn-inactive' : ''}`} title="Review step forward (→/Space)" onClick={() => setReviewStep(s => s === null ? 1 : s < totalReviewStepsRef.current ? s + 1 : 0)}>⏩</button>
        </div>
        <div class="nav-group">
          <button class="bar-btn" title="Previous problem (Shift+←)" onClick={onPrev}>◀</button>
          <button class="bar-btn" title="Next problem (Shift+→)" onClick={onNext}>▶</button>
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


function SummaryPanel({ onRetry, onNextUnsolved, reviewStep, totalSteps, onReviewBack, onReviewForward }) {
  let displayStep = reviewStep === null ? totalSteps : reviewStep
  return (
    <div class="summary-panel">
      <div class="scoring-title">Quiz Complete</div>
      <div class="review-controls">
        <button class="bar-btn" title="Step back (←)" onClick={onReviewBack}>◀</button>
        <span class="review-counter">{displayStep}/{totalSteps}</span>
        <button class="bar-btn" title="Step forward (→/Space)" onClick={onReviewForward}>▶</button>
      </div>
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
          <tr><td class="help-key">⏪ ⏩</td><td>Review steps (when finished)</td><td class="help-shortcut">← →</td></tr>
          <tr><td class="help-key">◀ ▶</td><td>Previous / next problem</td><td class="help-shortcut">Shift+← →</td></tr>
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
        <div class="help-section">Review (after completion)</div>
        <table class="help-table">
          <tr><td class="help-key">⏪ ⏩</td><td>Step through moves &amp; questions</td><td class="help-shortcut">← → Space</td></tr>
        </table>
      </div>
    </div>
  )
}
