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
  let [wrongFlash, setWrongFlash] = useState(false)
  let [retryHint, setRetryHint] = useState(false)
  let [introHint, setIntroHint] = useState(false)
  let [modeHint, setModeHint] = useState(null)
  let [settingsHint, setSettingsHint] = useState(false)

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

  let anyHint = retryHint || introHint || modeHint || settingsHint
  let anyHintRef = useRef(false)
  anyHintRef.current = anyHint

  let checkAdvanceHints = () => {
    if (engine.moveIndex === 1 && !kv('seenIntroHint')) {
      kvSet('seenIntroHint', '1')
      setIntroHint(true)
    } else if (engine.moveIndex >= 5 && !kv('seenSettingsHint')) {
      kvSet('seenSettingsHint', '1')
      setSettingsHint(true)
    }
  }

  let submitAnswer = useCallback((value) => {
    if (anyHintRef.current) return
    let hasQuestion = engine.mode === 'comparison' ? engine.comparisonPair : engine.questionVertex
    if (!hasQuestion) {
      if (engine.showingMove) {
        engine.activateQuestions()
        let activated = engine.mode === 'comparison' ? engine.comparisonPair : engine.questionVertex
        if (!activated && !engine.finished) {
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
        timesRef.current.push(performance.now() - questionStartRef.current)
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
      if (e.key === 'Escape') { e.preventDefault(); if (anyHintRef.current) { setRetryHint(false); setIntroHint(false); setModeHint(null); setSettingsHint(false) } else if (showConfigRef.current) setShowConfig(false); else if (showHelpRef.current) setShowHelp(false); else onBack() }
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
      else if (engine.mode === 'comparison' && e.key === 'q') submitAnswer(1)
      else if (engine.mode === 'comparison' && e.key === 'w') submitAnswer(2)
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
    if (hasQ && questionStartRef.current === null) {
      questionStartRef.current = performance.now()
      let hintKey = engine.mode === 'comparison' ? 'seenComparisonHint' : 'seenLibertyHint'
      if (!kv(hintKey)) {
        kvSet(hintKey, '1')
        setModeHint(engine.mode)
      }
    }
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

  // Show phase: opaque stone with move number for the just-played move
  if (engine.currentMove && engine.showingMove) {
    let [x, y] = engine.currentMove.vertex
    signMap[y][x] = engine.currentMove.sign
    markerMap[y][x] = { type: 'label', label: String(engine.moveIndex) }
  }

  // During retry: show move numbers on all revealed stones
  for (let { vertex, moveNumber } of engine.revealedStones) {
    let [x, y] = vertex
    markerMap[y][x] = { type: 'label', label: String(moveNumber) }
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
    markerMap[y1][x1] = { type: 'label', label: 'Q' }
    markerMap[y2][x2] = { type: 'label', label: 'W' }
  } else if (engine.questionVertex) {
    let [x, y] = engine.questionVertex
    markerMap[y][x] = { type: 'label', label: '❓' }
  }

  return (
    <div class="quiz">
      <div class="board-section">
      {engine.finished
        ? <StatsBar engine={engine} times={timesRef.current} />
        : <ProgressBar questionsPerMove={engine.questionsPerMove} moveProgress={engine.moveProgress} questionIndex={engine.questionIndex} showingMove={engine.showingMove} moves={engine.moves} />}
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
        maxQ={maxQ} soundOn={soundOn} showDuration={showDuration}
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

      {settingsHint && <div class="overlay">
        <div class="overlay-content">
          <div class="overlay-header">
            <b>Tip</b>
            <button class="bar-btn" onClick={() => setSettingsHint(false)}>X</button>
          </div>
          <p>Press &#x2699; to adjust settings — enable timed auto-advance so stones disappear automatically, or change the number of questions per move.</p>
        </div>
      </div>}
      {modeHint && <div class="overlay">
        <div class="overlay-content">
          <div class="overlay-header">
            <b>{modeHint === 'comparison' ? 'Comparison mode' : 'Liberty mode'}</b>
            <button class="bar-btn" onClick={() => setModeHint(null)}>X</button>
          </div>
          {modeHint === 'comparison'
            ? <p>Two groups are marked Q and W. Choose which has more liberties, or equal.</p>
            : <p>A group is marked with &#x2753;. Count its liberties and pick the right number (1–4 or 5+).</p>}
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
          <p>Wrong answer — all hidden stones are now revealed. Answer the same question again to continue.</p>
        </div>
      </div>}
      <div class="bottom-bar">
        {(() => {
          if (engine.finished) return <div class="answer-buttons" />
          if (engine.moveIndex === 0) return <ModeChoice mode={mode} onChoice={nextMode => {
            kvSet('quizMode', nextMode)
            setMode(nextMode)
            engine.mode = nextMode
            engine.recomputeQuestions()
            submitAnswer(0)
          }} />
          let hasQuestion = engine.mode === 'comparison' ? engine.comparisonPair : engine.questionVertex
          if (!hasQuestion) return engine.showingMove && showDuration !== 'manual'
            ? <div class="answer-buttons" />
            : <NextButton label="Next" onNext={() => submitAnswer(0)} />
          return engine.mode === 'comparison'
            ? <ComparisonButtons onAnswer={submitAnswer} />
            : <AnswerButtons onAnswer={submitAnswer} />
        })()}
      </div>
      </div>
    </div>
  )
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


function ProgressBar({ questionsPerMove, moveProgress, questionIndex, showingMove, moves }) {
  let total = questionsPerMove.length
  let currentMove = moveProgress.length - 1
  let CONTEXT = 3
  let needsWindow = total > CONTEXT * 2 + 1
  let start = needsWindow ? Math.max(0, Math.min(currentMove - CONTEXT, total - CONTEXT * 2 - 1)) : 0
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
          let isCurrent = i === currentMove
          return (
            <div key={i} class={`progress-move${isCurrent ? ' current' : ''}`}>
              <span class={`move-stone${moves[i].sign === 1 ? ' stone-black' : ' stone-white'}${isCurrent && showingMove ? ' q-current' : ''}`}>{i + 1}</span>
              {qCount === 0
                ? <span class="check-skip" />
                : Array.from({ length: qCount }, (_, j) => {
                  let isActiveQ = isCurrent && !showingMove && j === questionIndex
                  let cls = results[j] === 'correct' ? 'q-correct' : results[j] === 'failed' ? 'q-failed' : 'q-pending'
                  if (isActiveQ) cls += ' q-current'
                  return <span key={j} class={cls}>{results[j] === 'correct' ? '✓' : results[j] === 'failed' ? '✗' : '?'}</span>
                })}
            </div>
          )
        })}
        <span class={`progress-ellipsis${needsWindow && end < total ? '' : ' invisible'}`}>…</span>
      </div>
    </div>
  )
}

export function computeStats(times, cap = 5000) {
  let capped = times.map(t => Math.min(t, cap))
  let avg = capped.length > 0 ? capped.reduce((a, b) => a + b, 0) / capped.length : 0
  let sd = capped.length > 1 ? Math.sqrt(capped.reduce((a, b) => a + (b - avg) ** 2, 0) / capped.length) : 0
  return { avg, sd }
}

function StatsBar({ engine, times }) {
  let total = engine.results.length
  let pct = total > 0 ? Math.round(engine.correct / total * 100) : 0
  let { avg, sd } = computeStats(times)
  return (
    <div class="progress-bar">
      <span class="stats-line">
        {engine.correct}/{total} ({pct}%)
        {times.length > 0 && <> &middot; {(avg / 1000).toFixed(1)}s {sd > 0 ? `\u00b1${(sd / 1000).toFixed(1)}s` : ''}</>}
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

function ModeChoice({ mode, onChoice }) {
  return (
    <div class="answer-buttons">
      <button class={`bar-btn next-btn${mode === 'liberty' ? ' mode-active' : ''}`} onClick={() => onChoice('liberty')}>① Liberty</button>
      <button class={`bar-btn next-btn${mode === 'comparison' ? ' mode-active' : ''}`} onClick={() => onChoice('comparison')}>⚖ Compare</button>
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
      <button class="ans-btn black-stone-btn" title="Group Q has more liberties (key Q)" onClick={() => onAnswer(1)}>Q</button>
      <button class="bar-btn ans-btn eq-btn" title="Both groups have equal liberties (Space)" onClick={() => onAnswer(3)}>=</button>
      <button class="ans-btn white-stone-btn" title="Group W has more liberties (key W)" onClick={() => onAnswer(2)}>W</button>
    </div>
  )
}

function ConfigPanel({ maxQ, soundOn, showDuration, onMaxQ, onSound, onShowDuration, onClose }) {
  return (
    <div class="overlay" onClick={onClose}>
      <div class="overlay-content" onClick={e => e.stopPropagation()}>
        <div class="overlay-header">
          <b>Settings</b>
          <button class="bar-btn" onClick={onClose}>X</button>
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
                <tr><td class="help-key">Q</td><td>Group marked "Q" has more liberties</td><td class="help-shortcut">Q</td></tr>
                <tr><td class="help-key">=</td><td>Both groups have equal liberties</td><td class="help-shortcut">Space</td></tr>
                <tr><td class="help-key">W</td><td>Group marked "W" has more liberties</td><td class="help-shortcut">W</td></tr>
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

