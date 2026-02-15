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
  let [mode, setMode] = useState(() => kv('quizMode', 'liberty'))
  let [maxQ, setMaxQ] = useState(() => parseInt(kv('quizMaxQ', '2')))
  let [error, setError] = useState(null)
  let [showHelp, _setShowHelp] = useState(false)
  let showHelpRef = useRef(false)
  let setShowHelp = (v) => { let next = typeof v === 'function' ? v(showHelpRef.current) : v; showHelpRef.current = next; _setShowHelp(next) }
  let [showDuration, setShowDuration] = useState(() => kv('quizShowDuration', 'manual'))
  let questionStartRef = useRef(null)
  let timesRef = useRef([])
  let moveTimingRef = useRef([]) // [{moveViewMs, questionTimes: [ms...]}]
  let moveViewStartRef = useRef(null)
  let [showConfig, _setShowConfig] = useState(false)
  let showConfigRef = useRef(false)
  let setShowConfig = (v) => { let next = typeof v === 'function' ? v(showConfigRef.current) : v; showConfigRef.current = next; _setShowConfig(next) }
  let [wrongFlash, setWrongFlash] = useState(false)
  let [retryHint, setRetryHint] = useState(false)
  let [introHint, setIntroHint] = useState(false)
  let [modeHint, setModeHint] = useState(null)
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
      let scoreEntry = { accuracy, avgTimeMs: Math.round(avg), date: Date.now(), mode, moveTiming: moveTimingRef.current }
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

  let trackAdvance = () => {
    moveViewStartRef.current = performance.now()
  }

  let trackActivate = () => {
    let moveViewMs = moveViewStartRef.current !== null
      ? performance.now() - moveViewStartRef.current : 0
    moveViewStartRef.current = null
    moveTimingRef.current.push({ moveViewMs, questionTimes: [] })
  }

  let submitAnswer = useCallback((value) => {
    if (anyHintRef.current) return
    let hasQuestion = engine.mode === 'comparison' ? engine.comparisonPair : engine.questionVertex
    if (!hasQuestion) {
      if (engine.showingMove) {
        trackActivate()
        engine.activateQuestions()
        if (engine.moveIndex === 1 && !kv('seenIntroHint')) {
          kvSet('seenIntroHint', '1')
          setIntroHint(true)
        }
        let activated = engine.mode === 'comparison' ? engine.comparisonPair : engine.questionVertex
        if (!activated && !engine.finished) {
          engine.advance()
          trackAdvance()
          checkAdvanceHints()
        }
      } else if (!engine.finished) {
        engine.advance()
        trackAdvance()
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
        let mt = moveTimingRef.current
        if (mt.length > 0) mt[mt.length - 1].questionTimes.push({ ms: elapsed, failed: false })
      }
      historyRef.current.push(!wasRetrying)
      saveHistory(quizKey, historyRef.current)
      playCorrect()
      if (result.done) {
        engine.advance()
        trackAdvance()
        checkAdvanceHints()
      }
      let total = engine.questionsPerMove.reduce((a, b) => a + b, 0)
      onProgress({ correct: engine.correct, done: engine.results.length, total })
    } else {
      // Record failed attempt time, restart timer for retry
      if (questionStartRef.current !== null) {
        let elapsed = performance.now() - questionStartRef.current
        let mt = moveTimingRef.current
        if (mt.length > 0) mt[mt.length - 1].questionTimes.push({ ms: elapsed, failed: true })
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
      if (e.key === 'Escape') { e.preventDefault(); if (anyHintRef.current) { setRetryHint(false); setIntroHint(false); setModeHint(null); setSettingsHint(false) } else if (showConfigRef.current) setShowConfig(false); else if (showHelpRef.current) setShowHelp(false); else onBack() }
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
        let hasQuestion = engine.mode === 'comparison' ? engine.comparisonPair : engine.questionVertex
        if (engine.finished) setReviewStep(s => s === null ? 1 : s < totalReviewStepsRef.current ? s + 1 : 0)
        else if (engine.mode === 'comparison' && engine.comparisonPair) submitAnswer(3)
        else if (!hasQuestion) submitAnswer(0)
      }
      else if (e.key === 'PageUp') { e.preventDefault(); onPrev() }
      else if (e.key === 'PageDown') { e.preventDefault(); onNext() }
      else if (engine.mode === 'comparison' && e.key === 'z') submitAnswer(1)
      else if (engine.mode === 'comparison' && e.key === 'x') submitAnswer(2)
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
      setVertexSize(Math.max(1, Math.floor(Math.min(width / (cols + 1), height / (rows + 1)))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [cols, rows])

  // Color Z/X comparison markers blue (only those, not move numbers)
  useEffect(() => {
    let el = boardRowRef.current
    if (!el) return
    for (let m of el.querySelectorAll('.shudan-marker')) {
      let t = m.textContent
      if (t === 'Z' || t === 'X') m.style.setProperty('color', '#6af', 'important')
      else m.style.removeProperty('color')
    }
  })

  // Compute total review steps: 1 per stone + 1 per question
  totalReviewStepsRef.current = 0
  if (engine.finished) {
    for (let i = 0; i < engine.totalMoves; i++)
      totalReviewStepsRef.current += 1 + (engine.questionsAsked[i]?.length || 0)
  }

  // Build display maps
  let size = engine.boardSize
  let signMap, markerMap, ghostStoneMap, reviewMoveIndex = -1

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
        if (q.v1) {
          let [x, y] = q.v1
          if (reviewBoard.get(q.v1) !== 0) markerMap[y][x] = { type: 'label', label: 'Z' }
        }
        if (q.v2) {
          let [x, y] = q.v2
          if (reviewBoard.get(q.v2) !== 0) markerMap[y][x] = { type: 'label', label: 'X' }
        }
      }
    }
    signMap = reviewBoard.signMap
    reviewMoveIndex = movesShown - 1
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

    // During retry: show move numbers on non-captured revealed stones
    for (let { vertex, moveNumber } of engine.revealedStones) {
      let [x, y] = vertex
      if (engine.trueBoard.get(vertex) !== 0)
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
      markerMap[y1][x1] = { type: 'label', label: 'Z' }
      markerMap[y2][x2] = { type: 'label', label: 'X' }
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
      <div class="board-section">
      {engine.finished
        ? <StatsBar engine={engine} times={timesRef.current} sgfId={sgfId} />
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

        {engine.finished && <SummaryPanel onRetry={onRetry} onNextUnsolved={onNextUnsolved}
          reviewStep={reviewStep} totalSteps={totalReviewStepsRef.current}
          onReviewBack={() => setReviewStep(s => s === null ? totalReviewStepsRef.current : s > 0 ? s - 1 : totalReviewStepsRef.current)}
          onReviewForward={() => setReviewStep(s => s === null ? 1 : s < totalReviewStepsRef.current ? s + 1 : 0)} />}
      </div>

      <div class="problem-name">
        {dirName && <span class="problem-dir">{dirName}</span>}
        <span class="problem-file">{engine.gameName || filename?.replace(/\.sgf$/i, '') || 'Untitled'}</span>
      </div>
      <div class="top-bar">
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

      {showConfig && <ConfigPanel
        mode={mode} maxQ={maxQ} soundOn={soundOn} showDuration={showDuration}
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
          <p>Press &#x2699; to adjust settings — enable timed auto-advance so stones disappear automatically.</p>
        </div>
      </div>}
      {modeHint && <div class="overlay">
        <div class="overlay-content">
          <div class="overlay-header">
            <b>{modeHint === 'comparison' ? 'Comparison mode' : 'Liberty mode'}</b>
            <button class="bar-btn" onClick={() => setModeHint(null)}>X</button>
          </div>
          {modeHint === 'comparison'
            ? <p>Two groups are marked Z and X. Choose which has more liberties, or equal.</p>
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
          <p>Wrong answer — all hidden stones are now revealed. Answer the same question again to continue. Future moves will show extra context.</p>
        </div>
      </div>}
      <div class="bottom-bar">
        {(() => {
          if (engine.finished) return moveTimingRef.current.length > 0
            ? <TimeChart moveTiming={moveTimingRef.current} moves={engine.moves} reviewMoveIndex={reviewMoveIndex} />
            : <div class="answer-buttons" />
          if (engine.moveIndex === 0) return <ModeChoice mode={mode} maxQ={maxQ}
            onMode={nextMode => {
              kvSet('quizMode', nextMode)
              setMode(nextMode)
              engine.mode = nextMode
              engine.recomputeQuestions()
              rerender()
            }}
            onStart={() => submitAnswer(0)}
            onMaxQ={next => {
              kvSet('quizMaxQ', String(next))
              setMaxQ(next)
              engine.maxQuestions = next
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

function StatsBar({ engine, times, sgfId }) {
  let total = engine.results.length
  let pct = total > 0 ? Math.round(engine.correct / total * 100) : 0
  let { avg, sd } = computeStats(times)
  let scores = sgfId ? getScores(sgfId) : []
  let best = scores.length > 0 ? scores.reduce((b, s) =>
    s.accuracy > b.accuracy || (s.accuracy === b.accuracy && s.avgTimeMs < b.avgTimeMs) ? s : b
  ) : null
  return (
    <div class="stats-expanded">
      <div class="stats-grid">
        <span class="stats-cell">{engine.correct}/{total} ({pct}%)</span>
        {times.length > 0 && <span class="stats-cell">{Math.round(avg)}ms {sd > 0 ? `\u00b1${Math.round(sd)}ms` : ''}</span>}
        {best && <span class="stats-cell stats-best">Best: {Math.round(best.accuracy * 100)}% {best.avgTimeMs}ms</span>}
        {scores.length > 0 && <span class="stats-cell stats-runs">Run #{scores.length + 1}</span>}
      </div>
    </div>
  )
}


function TimeChart({ moveTiming, moves, reviewMoveIndex }) {
  let moveCount = moveTiming.length
  let barW = 10
  let barGap = 1
  let [chartH, setChartH] = useState(120)

  // Count total bars per move (1 moveView + N questions), compute x offsets
  let moveOffsets = [] // [{x, barCount}]
  let totalBars = 0
  for (let m of moveTiming) {
    let count = 1 + m.questionTimes.length
    moveOffsets.push({ x: totalBars * (barW + barGap), barCount: count })
    totalBars += count
  }

  let axisW = 30
  let chartW = totalBars * (barW + barGap)
  let svgW = axisW + chartW + 4
  let labelH = 14

  // Find max time across current and best, capped at 5000ms
  let cap = 5000
  let maxTime = 0
  for (let m of moveTiming) {
    maxTime = Math.max(maxTime, m.moveViewMs)
    for (let t of m.questionTimes) maxTime = Math.max(maxTime, t.ms)
  }
  if (maxTime === 0) maxTime = 1000
  maxTime = Math.min(maxTime, cap)

  // Nice tick values
  let ticks = []
  let step = maxTime <= 500 ? 100 : maxTime <= 2000 ? 500 : maxTime <= 5000 ? 1000 : 2000
  for (let v = step; v <= maxTime; v += step) ticks.push(v)

  let barH = (ms) => Math.max(1, ms / maxTime * chartH)
  let fmt = (ms) => ms >= 1000 ? (ms / 1000) + 's' : ms + 'ms'

  let dragRef = useRef(null)
  let chartRef = useRef(null)
  let onMouseDown = (e) => { dragRef.current = { x: e.clientX, scrollLeft: e.currentTarget.scrollLeft }; e.currentTarget.style.cursor = 'grabbing' }
  let onMouseMove = (e) => { if (!dragRef.current) return; e.currentTarget.scrollLeft = dragRef.current.scrollLeft - (e.clientX - dragRef.current.x) }
  let onMouseUp = (e) => { dragRef.current = null; e.currentTarget.style.cursor = '' }

  // Dynamic chart height from container
  useEffect(() => {
    let el = chartRef.current
    if (!el) return
    let ro = new ResizeObserver(entries => {
      let h = entries[0].contentRect.height
      setChartH(Math.max(60, h - labelH - 8))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Auto-scroll to keep highlighted bar visible
  useEffect(() => {
    let el = chartRef.current
    if (!el || reviewMoveIndex < 0 || reviewMoveIndex >= moveCount) return
    let { x: hx, barCount } = moveOffsets[reviewMoveIndex]
    let left = axisW + hx - 10
    let right = axisW + hx + barCount * (barW + barGap) + 10
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth
  }, [reviewMoveIndex])

  return (
    <div class="time-chart" ref={chartRef} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
      <svg width={svgW} height={chartH + labelH} viewBox={`0 0 ${svgW} ${chartH + labelH}`}>
        {/* Y-axis ticks and gridlines */}
        {ticks.map(v => {
          let y = chartH - v / maxTime * chartH
          return [
            <line key={`grid-${v}`} x1={axisW} y1={y} x2={svgW} y2={y} stroke="#333" stroke-width="0.5" />,
            <text key={`tick-${v}`} x={axisW - 3} y={y + 3} text-anchor="end" fill="#666" font-size="7">{fmt(v)}</text>
          ]
        })}
        {/* Highlight current review step */}
        {reviewMoveIndex >= 0 && reviewMoveIndex < moveCount && (() => {
          let { x: hx, barCount } = moveOffsets[reviewMoveIndex]
          let groupW = barCount * (barW + barGap) - barGap
          return <rect x={axisW + hx - 1} y={0} width={groupW + 2} height={chartH} fill="rgba(255,255,255,0.08)" />
        })()}
        {/* Bars */}
        {moveTiming.map((m, i) => {
          let { x: mx } = moveOffsets[i]
          let x0 = axisW + mx
          let bars = []
          // Current run bars — move-view bar colored by stone color
          let h = barH(m.moveViewMs)
          let moveColor = moves[i]?.sign === 1 ? '#222' : '#ddd'
          bars.push(<rect key={`mv-${i}`} x={x0} y={chartH - h} width={barW} height={h} fill={moveColor} />)
          for (let j = 0; j < m.questionTimes.length; j++) {
            let qx = x0 + (j + 1) * (barW + barGap)
            let qh = barH(m.questionTimes[j].ms)
            let fill = m.questionTimes[j].failed ? '#c44' : '#4a4'
            bars.push(<rect key={`q-${i}-${j}`} x={qx} y={chartH - qh} width={barW} height={qh} fill={fill} />)
          }
          // Move number label under the move-view bar
          bars.push(<text key={`lbl-${i}`} x={x0 + barW / 2} y={chartH + 10} text-anchor="middle" fill="#888" font-size="7">{i + 1}</text>)
          return bars
        })}
        {/* Baseline */}
        <line x1={axisW} y1={chartH} x2={svgW} y2={chartH} stroke="#555" stroke-width="0.5" />
      </svg>
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

function ModeChoice({ mode, maxQ, onMode, onStart, onMaxQ }) {
  return (
    <div class="mode-choice">
      <div class="cfg-row">
        <span class="cfg-label">Mode</span>
        <div class="cfg-options">
          <button class={`cfg-opt${mode === 'liberty' ? ' active' : ''}`} onClick={() => onMode('liberty')}>Liberty</button>
          <button class={`cfg-opt${mode === 'liberty-end' ? ' active' : ''}`} onClick={() => onMode('liberty-end')}>Lib@end</button>
          <button class={`cfg-opt${mode === 'comparison' ? ' active' : ''}`} onClick={() => onMode('comparison')}>Compare</button>
        </div>
      </div>
      {mode !== 'liberty-end' && <div class="cfg-row">
        <span class="cfg-label">Questions</span>
        <div class="cfg-options">
          {[0, 1, 2, 3, 4].map(n => (
            <button key={n} class={`cfg-opt${maxQ === n ? ' active' : ''}`} onClick={() => onMaxQ(n)}>{n}</button>
          ))}
        </div>
      </div>}
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

function ComparisonButtons({ onAnswer }) {
  return (
    <div class="answer-buttons">
      <button class="ans-btn comp-btn" title="Group Z has more liberties (key Z)" onClick={() => onAnswer(1)}>Z</button>
      <button class="ans-btn comp-btn" title="Both groups have equal liberties (Space)" onClick={() => onAnswer(3)}>=</button>
      <button class="ans-btn comp-btn" title="Group X has more liberties (key X)" onClick={() => onAnswer(2)}>X</button>
    </div>
  )
}

function ConfigPanel({ mode, maxQ, soundOn, showDuration, onMaxQ, onSound, onShowDuration, onClose }) {
  return (
    <div class="overlay" onClick={onClose}>
      <div class="overlay-content" onClick={e => e.stopPropagation()}>
        <div class="overlay-header">
          <b>Settings</b>
          <button class="bar-btn" onClick={onClose}>X</button>
        </div>
        {mode !== 'liberty-end' && <div class="cfg-row">
          <span class="cfg-label">Questions</span>
          <div class="cfg-options">
            {[0, 1, 2, 3, 4].map(n => (
              <button key={n} class={`cfg-opt${maxQ === n ? ' active' : ''}`} onClick={() => onMaxQ(n)}>{n}</button>
            ))}
          </div>
        </div>}
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
          <tr><td class="help-key">⏪ ⏩</td><td>Review steps (when finished)</td><td class="help-shortcut">← →</td></tr>
          <tr><td class="help-key">◀ ▶</td><td>Previous / next problem</td><td class="help-shortcut">Shift+← →</td></tr>
          <tr><td class="help-key">⚙</td><td>Open settings (mode, questions, sound)</td><td /></tr>
        </table>
        <div class="help-section">Answering</div>
        <table class="help-table">
          {mode === 'comparison'
            ? <>
                <tr><td class="help-key">Z</td><td>Group marked "Z" has more liberties</td><td class="help-shortcut">Z</td></tr>
                <tr><td class="help-key">=</td><td>Both groups have equal liberties</td><td class="help-shortcut">Space</td></tr>
                <tr><td class="help-key">X</td><td>Group marked "X" has more liberties</td><td class="help-shortcut">X</td></tr>
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

