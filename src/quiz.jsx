import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { Goban } from '@sabaki/shudan'
import { QuizEngine } from './engine.js'
import { playCorrect, playWrong, playComplete, playStoneClick, playMark, resetStreak, isSoundEnabled, toggleSound } from './sounds.js'
import { kv, kvRemove, getScores, addReplay, getReplay } from './db.js'

function makeEmptyMap(size, fill = null) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

function transpose(map) {
  let rows = map.length
  let cols = map[0].length
  return Array.from({ length: cols }, (_, x) => Array.from({ length: rows }, (_, y) => map[y][x]))
}

export function Quiz({ sgf, sgfId, quizKey, wasSolved, onBack, onSolved, onUnsolved, onProgress, onLoadError, onNextUnsolved, onRetry }) {
  let engineRef = useRef(null)
  let solvedRef = useRef(false)
  let [, forceRender] = useState(0)
  let rerender = () => forceRender(n => n + 1)
  let [vertexSize, setVertexSize] = useState(0)
  let [rotated, setRotated] = useState(false)
  let boardRowRef = useRef(null)
  let [maxQ] = useState(() => parseInt(kv('quizMaxQ', '2')))
  let [error, setError] = useState(null)
  let questionStartRef = useRef(null)
  let timesRef = useRef([])
  let [wrongFlash, setWrongFlash] = useState(false)
  let [markedLiberties, setMarkedLiberties] = useState(new Set())
  let [reviewVertex, setReviewVertex] = useState(null)
  let [reviewComp, setReviewComp] = useState(null) // { compIdx, correct } or null
  let [soundOn, setSoundOn] = useState(() => isSoundEnabled())

  // Replay recording
  let replayEventsRef = useRef([])
  let replayStartRef = useRef(null)

  // Replay playback
  let [replayMode, setReplayMode] = useState(false)
  let replayModeRef = useRef(false)
  let replayDataRef = useRef(null)
  let replayMarksRef = useRef(new Set())
  let savedEngineRef = useRef(null)
  let savedSolvedRef = useRef(false)
  let savedReviewVertexRef = useRef(null)

  // Show sequence (step through moves during question phase)
  let [seqIdx, setSeqIdx] = useState(0) // 0 = inactive, 1+ = showing move N
  let seqSavedRef = useRef(null)

  function setReplayModeSync(val) {
    replayModeRef.current = val
    setReplayMode(val)
  }

  function recordEvent(evt) {
    if (replayModeRef.current) return
    if (!replayStartRef.current) replayStartRef.current = performance.now()
    replayEventsRef.current.push({ ...evt, t: Math.round(performance.now() - replayStartRef.current) })
  }

  // Initialize engine fresh every time, advance first move
  if (!engineRef.current && !error) {
    resetStreak()
    try {
      engineRef.current = new QuizEngine(sgf, true, maxQ)
      engineRef.current.advance()
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
    if (replayModeRef.current) return
    if (engine.finished && !solvedRef.current) {
      solvedRef.current = true
      let total = engine.results.length
      let accuracy = total > 0 ? engine.correct / total : 1
      let totalMs = timesRef.current.reduce((a, b) => a + b, 0)
      let date = Date.now()
      let scoreEntry = { correct: engine.correct, total, accuracy, totalMs: Math.round(totalMs), errors: engine.errors, date }
      addReplay(sgfId, date, replayEventsRef.current)
      onSolved(engine.correct, total, scoreEntry)
      playComplete()
    }
  }

  function startReplay(scoreEntry) {
    let events = getReplay(sgfId, scoreEntry.date)
    if (!events || events.length === 0) return

    // Save current state
    savedEngineRef.current = engineRef.current
    savedSolvedRef.current = solvedRef.current
    savedReviewVertexRef.current = reviewVertex

    // Create fresh engine for replay
    try {
      engineRef.current = new QuizEngine(sgf, true, maxQ)
      engineRef.current.advance()
    } catch { return }

    // Reset transient state
    solvedRef.current = false
    setMarkedLiberties(new Set())
    setReviewVertex(null)
    setWrongFlash(false)
    questionStartRef.current = null
    replayMarksRef.current = new Set()
    replayDataRef.current = events

    setReplayModeSync(true)
    rerender()
  }

  function restoreSavedState() {
    setReplayModeSync(false)
    replayDataRef.current = null
    replayMarksRef.current = new Set()
    setMarkedLiberties(new Set())
    // Restore saved engine and state
    engineRef.current = savedEngineRef.current
    solvedRef.current = savedSolvedRef.current
    setReviewVertex(savedReviewVertexRef.current)
    savedEngineRef.current = null
    savedSolvedRef.current = false
    savedReviewVertexRef.current = null
    rerender()
  }

  function exitReplayEarly() {
    restoreSavedState()
  }

  function startShowSequence() {
    seqSavedRef.current = { marks: markedLiberties, questionStart: questionStartRef.current }
    setMarkedLiberties(new Set())
    setSeqIdx(1)
  }

  function exitShowSequence() {
    let saved = seqSavedRef.current
    seqSavedRef.current = null
    setSeqIdx(0)
    if (saved) {
      setMarkedLiberties(saved.marks)
      questionStartRef.current = saved.questionStart
    }
  }

  function advanceShowSequence() {
    let targetIdx = engineRef.current.moveIndex
    setSeqIdx(prev => {
      if (prev >= targetIdx) { exitShowSequence(); return 0 }
      return prev + 1
    })
  }

  let advance = useCallback(() => {
    if (engine.finished || engine.questionVertex || engine.comparisonPair) return
    if (engine.showingMove) {
      engine.activateQuestions()
      if (!engine.questionVertex && !engine.comparisonPair && !engine.finished) {
        engine.advance()
        if (engine.showingMove) playStoneClick()
      }
    } else {
      engine.advance()
      if (engine.showingMove) playStoneClick()
    }
    checkFinished()
    rerender()
  }, [])

  let submitMarks = useCallback(() => {
    if (!engine.questionVertex) return
    let result = engine.answerMark(markedLiberties)
    if (questionStartRef.current !== null) {
      let elapsed = performance.now() - questionStartRef.current
      timesRef.current.push(elapsed)
      questionStartRef.current = null
    }
    if (result.penalties === 0) playCorrect()
    else {
      playWrong()
      setWrongFlash(true)
      setTimeout(() => setWrongFlash(false), 150)
    }
    setMarkedLiberties(new Set())
    if (result.done) engine.advance()
    let total = engine.questionsPerMove.reduce((a, b) => a + b, 0)
    onProgress({ correct: engine.correct, done: engine.results.length, total })
    checkFinished()
    rerender()
  }, [markedLiberties])

  let submitComparison = useCallback((choice) => {
    if (!engine.comparisonPair) return
    let result = engine.answerComparison(choice)
    if (questionStartRef.current !== null) {
      let elapsed = performance.now() - questionStartRef.current
      timesRef.current.push(elapsed)
      questionStartRef.current = null
    }
    if (result.correct) playCorrect()
    else {
      playWrong()
      setWrongFlash(true)
      setTimeout(() => setWrongFlash(false), 150)
    }
    if (result.done) engine.advance()
    let total = engine.questionsPerMove.reduce((a, b) => a + b, 0)
    onProgress({ correct: engine.correct, done: engine.results.length, total })
    checkFinished()
    rerender()
  }, [])

  let onVertexClick = useCallback((evt, vertex) => {
    if (replayModeRef.current) { exitReplayEarly(); return }
    if (seqIdx > 0) { advanceShowSequence(); return }
    let key = `${vertex[0]},${vertex[1]}`
    // Review mode: toggle liberty display on tap
    if (engine.finished) {
      setReviewComp(null)
      setReviewVertex(prev => prev === key ? null : key)
      return
    }
    recordEvent({ v: [vertex[0], vertex[1]] })
    // Comparison phase: click Z or X stone
    if (engine.comparisonPair) {
      let pair = engine.comparisonPair
      let zKey = `${pair.vertexZ[0]},${pair.vertexZ[1]}`
      let xKey = `${pair.vertexX[0]},${pair.vertexX[1]}`
      let eqKey = engine.equalVertex ? `${engine.equalVertex[0]},${engine.equalVertex[1]}` : null
      if (key === zKey) { recordEvent({ cmp: 'Z' }); submitComparison('Z') }
      else if (key === xKey) { recordEvent({ cmp: 'X' }); submitComparison('X') }
      else if (eqKey && key === eqKey) { recordEvent({ cmp: 'equal' }); submitComparison('equal') }
      return
    }
    // No question: tap = advance
    if (!engine.questionVertex) {
      advance()
      return
    }
    // Tapping the question mark → submit if marks exist, otherwise ignore
    if (key === `${engine.questionVertex[0]},${engine.questionVertex[1]}`) {
      if (markedLiberties.size > 0) { recordEvent({ s: 1 }); submitMarks() }
      return
    }
    // Toggle liberty mark
    playMark()
    setMarkedLiberties(prev => {
      let next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [advance, markedLiberties, submitMarks, submitComparison])

  let toggleSolved = useCallback(() => {
    if (wasSolved) {
      onUnsolved()
      onBack()
    } else {
      onSolved(0, 0, null)
      onNextUnsolved()
    }
  }, [wasSolved])

  // Keyboard shortcuts
  useEffect(() => {
    let preSolve = !engine.finished && engine.results.length === 0
    function onKeyDown(e) {
      if (e.repeat) return
      if (replayModeRef.current) {
        if (e.key === 'Escape') { e.preventDefault(); exitReplayEarly() }
        return
      }
      if (seqIdx > 0) {
        if (e.key === ' ') { e.preventDefault(); advanceShowSequence() }
        else if (e.key === 'Escape') { e.preventDefault(); exitShowSequence() }
        return
      }
      // Comparison phase: Z/X/Space keys
      if (engine.comparisonPair) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault(); recordEvent({ cmp: 'Z' }); submitComparison('Z')
        } else if (e.key === 'x' || e.key === 'X') {
          e.preventDefault(); recordEvent({ cmp: 'X' }); submitComparison('X')
        } else if (e.key === ' ') {
          e.preventDefault(); recordEvent({ cmp: 'equal' }); submitComparison('equal')
        } else if (e.key === 'Escape') { e.preventDefault(); onBack() }
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); onBack() }
      else if (e.key === 'Enter') {
        e.preventDefault()
        if (engine.finished) onNextUnsolved()
        else if (preSolve) toggleSolved()
      }
      else if ((e.key === 'r' || e.key === 'R') && engine.finished) {
        e.preventDefault()
        onRetry()
      }
      else if (e.key === ' ') {
        e.preventDefault()
        if (engine.questionVertex) {
          recordEvent({ s: 1 })
          submitMarks()
        }
        else if (!engine.finished) {
          recordEvent({ a: 1 })
          advance()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [advance, submitMarks, submitComparison])

  // Replay playback
  useEffect(() => {
    if (!replayMode) return
    let events = replayDataRef.current
    if (!events) return
    let cancelled = false

    async function play() {
      for (let i = 0; i < events.length; i++) {
        let delay = i === 0 ? events[i].t : events[i].t - events[i - 1].t
        await new Promise(r => setTimeout(r, Math.max(0, delay)))
        if (cancelled) return

        let eng = engineRef.current
        let evt = events[i]

        if (evt.cmp) {
          if (eng.comparisonPair) {
            let result = eng.answerComparison(evt.cmp)
            if (result.correct) playCorrect()
            else {
              playWrong()
              setWrongFlash(true)
              setTimeout(() => { if (!cancelled) setWrongFlash(false) }, 150)
            }
            if (result.done && !eng.finished) eng.advance()
          }
        } else if (evt.v) {
          if (eng.comparisonPair) {
            let pair = eng.comparisonPair
            let key = `${evt.v[0]},${evt.v[1]}`
            let zKey = `${pair.vertexZ[0]},${pair.vertexZ[1]}`
            let xKey = `${pair.vertexX[0]},${pair.vertexX[1]}`
            let choice = key === zKey ? 'Z' : key === xKey ? 'X' : null
            if (choice) {
              let result = eng.answerComparison(choice)
              if (result.correct) playCorrect()
              else {
                playWrong()
                setWrongFlash(true)
                setTimeout(() => { if (!cancelled) setWrongFlash(false) }, 150)
              }
              if (result.done && !eng.finished) eng.advance()
            }
          } else if (!eng.questionVertex) {
            if (eng.showingMove) {
              eng.activateQuestions()
              if (!eng.questionVertex && !eng.comparisonPair && !eng.finished) eng.advance()
            } else if (!eng.finished) {
              eng.advance()
            }
          } else {
            let key = `${evt.v[0]},${evt.v[1]}`
            let marks = replayMarksRef.current
            if (marks.has(key)) marks.delete(key)
            else marks.add(key)
            replayMarksRef.current = new Set(marks)
            setMarkedLiberties(new Set(marks))
          }
        } else if (evt.a) {
          if (!eng.finished && !eng.questionVertex && !eng.comparisonPair) {
            if (eng.showingMove) {
              eng.activateQuestions()
              if (!eng.questionVertex && !eng.comparisonPair && !eng.finished) eng.advance()
            } else {
              eng.advance()
            }
          }
        } else if (evt.s) {
          if (eng.questionVertex) {
            let marks = replayMarksRef.current
            let result = eng.answerMark(marks)
            if (result.penalties === 0) playCorrect()
            else {
              playWrong()
              setWrongFlash(true)
              setTimeout(() => { if (!cancelled) setWrongFlash(false) }, 150)
            }
            replayMarksRef.current = new Set()
            setMarkedLiberties(new Set())
            if (result.done && !eng.finished) eng.advance()
          }
        }

        if (!cancelled) rerender()
      }

      // Replay finished — pause briefly on final state, then restore original
      if (!cancelled) {
        await new Promise(r => setTimeout(r, 1500))
        if (!cancelled) restoreSavedState()
      }
    }

    play()
    return () => { cancelled = true }
  }, [replayMode])

  // Start question timer / clear marks when a question appears
  useEffect(() => {
    if (!engine) return
    if (replayModeRef.current) return
    let hasQuestion = engine.questionVertex || engine.comparisonPair
    if (hasQuestion && questionStartRef.current === null) {
      questionStartRef.current = performance.now()
      setMarkedLiberties(new Set())
    }
    if (!hasQuestion) questionStartRef.current = null
  })

  // Compute vertex size from container
  let rangeX = engine.boardRange ? [engine.boardRange[0], engine.boardRange[2]] : undefined
  let rangeY = engine.boardRange ? [engine.boardRange[1], engine.boardRange[3]] : undefined
  let cols = rangeX ? rangeX[1] - rangeX[0] + 1 : engine.boardSize
  let rows = rangeY ? rangeY[1] - rangeY[0] + 1 : engine.boardSize
  useEffect(() => {
    let el = boardRowRef.current
    if (!el) return
    let ro = new ResizeObserver(entries => {
      let { width, height } = entries[0].contentRect
      let normalSize = Math.floor(Math.min(width / (cols + 0.5), height / (rows + 0.5)))
      let rotatedSize = Math.floor(Math.min(width / (rows + 0.5), height / (cols + 0.5)))
      if (rotatedSize > normalSize * 1.1) {
        setRotated(true)
        setVertexSize(Math.max(1, rotatedSize))
      } else {
        setRotated(false)
        setVertexSize(Math.max(1, normalSize))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [cols, rows])

  // Build display maps
  let size = engine.boardSize
  let signMap, markerMap, ghostStoneMap, paintMap

  if (seqIdx > 0) {
    // Show base position + only the current move stone (like during the quiz)
    signMap = engine.baseSignMap.map(row => [...row])
    markerMap = makeEmptyMap(size)
    ghostStoneMap = makeEmptyMap(size)
    paintMap = makeEmptyMap(size)
    let move = engine.moves[seqIdx - 1]
    if (move) {
      let [x, y] = move.vertex
      signMap[y][x] = move.sign
      markerMap[y][x] = { type: 'label', label: String(seqIdx) }
    }
  } else if (engine.finished && !replayMode) {
    signMap = engine.trueBoard.signMap.map(row => [...row])
    markerMap = makeEmptyMap(size)
    ghostStoneMap = makeEmptyMap(size)
    paintMap = makeEmptyMap(size)

    let qByVertex = new Map()
    let ri = 0
    for (let moveQs of engine.questionsAsked)
      for (let q of moveQs) {
        if (q.vertex) qByVertex.set(`${q.vertex[0]},${q.vertex[1]}`, { ...q, correct: engine.results[ri] })
        ri++
      }

    // Place ✓ or mistake-count markers on questioned groups
    for (let [key, q] of qByVertex) {
      let [x, y] = key.split(',').map(Number)
      if (q.correct) {
        markerMap[y][x] = { type: 'label', label: '✓' }
      } else {
        let trueSet = new Set(q.trueLibs || [])
        let marksSet = new Set(q.marks || [])
        let mistakes = 0
        for (let k of marksSet) if (!trueSet.has(k)) mistakes++
        for (let k of trueSet) if (!marksSet.has(k)) mistakes++
        markerMap[y][x] = { type: 'label', label: String(mistakes) }
      }
    }

    // Clicked question: blue circles for correct, red crosses for errors
    if (reviewVertex && qByVertex.has(reviewVertex)) {
      let q = qByVertex.get(reviewVertex)
      let trueSet = new Set(q.trueLibs || [])
      let marksSet = new Set(q.marks || [])
      for (let k of marksSet) {
        let [x, y] = k.split(',').map(Number)
        markerMap[y][x] = trueSet.has(k)
          ? { type: 'circle' }
          : { type: 'cross' }
      }
      for (let k of trueSet) {
        if (marksSet.has(k)) continue
        let [x, y] = k.split(',').map(Number)
        markerMap[y][x] = { type: 'cross' }
      }
    }

    // Comparison review: show Z/X markers with green/red coloring
    if (reviewComp !== null) {
      let compQ = engine.comparisonQuestions[reviewComp.compIdx]
      if (compQ) {
        let [zx, zy] = compQ.vertexZ
        let [xx, xy] = compQ.vertexX
        markerMap[zy][zx] = { type: 'label', label: 'Z' }
        markerMap[xy][xx] = { type: 'label', label: 'X' }
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

    if (engine.questionVertex) {
      let [x, y] = engine.questionVertex
      markerMap[y][x] = { type: 'label', label: '?' }
      for (let key of markedLiberties) {
        let [mx, my] = key.split(',').map(Number)
        markerMap[my][mx] = { type: 'circle' }
      }
    }

    if (engine.comparisonPair) {
      let [zx, zy] = engine.comparisonPair.vertexZ
      let [xx, xy] = engine.comparisonPair.vertexX
      markerMap[zy][zx] = { type: 'label', label: 'Z' }
      markerMap[xy][xx] = { type: 'label', label: 'X' }
      if (engine.equalVertex) {
        let [ex, ey] = engine.equalVertex
        markerMap[ey][ex] = { type: 'label', label: '=' }
      }
    }
  }

  let preSolve = !engine.finished && engine.results.length === 0

  // Apply rotation if needed
  let displayRangeX = rangeX, displayRangeY = rangeY
  if (rotated) {
    signMap = transpose(signMap)
    markerMap = transpose(markerMap)
    ghostStoneMap = transpose(ghostStoneMap)
    paintMap = transpose(paintMap)
    displayRangeX = rangeY
    displayRangeY = rangeX
  }

  let handleVertexClick = rotated
    ? (evt, [x, y]) => onVertexClick(evt, [y, x])
    : onVertexClick

  let compClass = ''
  if (reviewComp) {
    let { userChoice, correct, trueAnswer } = reviewComp
    compClass = ' comp-review'
    if (userChoice === 'Z' || userChoice === 'X') {
      compClass += ` comp-${correct ? 'correct' : 'failed'}-${userChoice.toLowerCase()}`
    } else if (userChoice === 'equal' && !correct && (trueAnswer === 'Z' || trueAnswer === 'X')) {
      // User said equal but was wrong — show trueAnswer as correct
      compClass += ` comp-correct-${trueAnswer.toLowerCase()}`
    } else if (userChoice === 'equal' && correct) {
      compClass += ' comp-equal-correct'
    }
  }

  return (
    <div class="quiz">
      <div class="board-row" ref={boardRowRef}>
        {replayMode && <div class="replay-indicator">REPLAY</div>}
        {seqIdx > 0 && <div class="replay-indicator">SEQUENCE</div>}
        <div class={`board-container${wrongFlash ? ' wrong-flash' : ''}${engine.finished && !replayMode ? ' finished' : ''}${compClass}`}>
          {vertexSize > 0 && <Goban
            vertexSize={vertexSize}
            signMap={signMap}
            markerMap={markerMap}
            ghostStoneMap={ghostStoneMap}
            paintMap={paintMap}
            onVertexClick={handleVertexClick}
            rangeX={displayRangeX}
            rangeY={displayRangeY}
            showCoordinates={false}
            fuzzyStonePlacement={false}
            animateStonePlacement={false}
          />}
        </div>
      </div>

      <ProgressPips engine={engine} reviewVertex={reviewVertex} setReviewVertex={setReviewVertex} reviewComp={reviewComp} setReviewComp={setReviewComp} rerender={rerender} />

      <div class="bottom-bar">
        {replayMode
          ? <div class="replay-exit-hint">Tap board or press Esc to exit</div>
          : seqIdx > 0
            ? <div class="replay-exit-hint">Move {seqIdx}/{engine.moveIndex} — tap to advance</div>
            : <>
                {engine.comparisonPair
                  ? <div class="action-hint"><span>Tap the group with <span class="hint-blue">less</span> liberties, or <span class="hint-blue">=</span> on board</span></div>
                  : engine.questionVertex
                    ? <div class="action-hint">Tap all liberties of <span class="hint-blue">?</span> group, then tap <span class="hint-blue">?</span> or Space</div>
                    : engine.showingMove
                      ? <div class="action-hint">Tap board for the next move. Remember the sequence.</div>
                      : null}
                {engine.finished && !replayMode && <StatsBar sgfId={sgfId} onReplay={startReplay} />}
                <div class="bottom-bar-row">
                  <button class="bar-btn" title="Return to library (Esc)" onClick={onBack}>&#x25C2; Back</button>
                  <button class="bar-btn" title={`Sound ${soundOn ? 'on' : 'off'}`} onClick={() => { setSoundOn(toggleSound()) }}>{soundOn ? '\uD83D\uDD0A' : '\uD83D\uDD07'}</button>
                  {(engine.questionVertex || engine.comparisonPair) && <button class="bar-btn" title="Replay the move sequence" onClick={startShowSequence}>&#x25B6; Replay</button>}
                  {preSolve && engine.showingMove && <button class="bar-btn mark-solved-btn" title={wasSolved ? 'Remove solved mark' : 'Skip and mark as solved (Enter)'} onClick={toggleSolved}>{wasSolved ? 'Mark as unsolved' : 'Mark as solved'}</button>}
                  {engine.finished && <button class="bar-btn" title="Restart this problem (R)" onClick={onRetry}>Retry</button>}
                  {engine.finished && <button class="next-hero" title="Next unsolved problem (Enter)" onClick={onNextUnsolved}>Next</button>}
                </div>
              </>
        }
      </div>
    </div>
  )
}

function ProgressPips({ engine, reviewVertex, setReviewVertex, reviewComp, setReviewComp, rerender }) {
  let pips = []
  let resultIdx = 0
  let compIdxCounter = 0
  for (let moveIdx = 0; moveIdx < engine.moveProgress.length; moveIdx++) {
    let mp = engine.moveProgress[moveIdx]
    let asked = engine.questionsAsked[moveIdx] || []
    for (let qi = 0; qi < asked.length; qi++) {
      let status = resultIdx < mp.results.length ? mp.results[resultIdx] : 'pending'
      pips.push({ type: 'liberty', vertex: asked[qi].vertex, status, resultIdx })
      resultIdx++
    }
    let compCount = mp.total - asked.length
    for (let ci = 0; ci < compCount; ci++) {
      let status = resultIdx < mp.results.length ? mp.results[resultIdx] : 'pending'
      pips.push({ type: 'comparison', status, resultIdx, compIdx: compIdxCounter++ })
      resultIdx++
    }
  }

  let showPips = pips.length > 0 && !engine.showingMove

  let handleClick = (pip) => {
    if (!engine.finished) return
    if (pip.type === 'liberty' && pip.vertex) {
      let key = `${pip.vertex[0]},${pip.vertex[1]}`
      setReviewComp(null)
      setReviewVertex(prev => prev === key ? null : key)
      rerender()
    } else if (pip.type === 'comparison') {
      setReviewVertex(null)
      let compQ = engine.comparisonQuestions[pip.compIdx]
      setReviewComp(prev => prev?.compIdx === pip.compIdx ? null : { compIdx: pip.compIdx, correct: pip.status === 'correct', userChoice: compQ?.userChoice, trueAnswer: compQ?.trueAnswer })
      rerender()
    }
  }

  return (
    <div class="progress-pips">
      {showPips && pips.map((pip, i) => {
        let cls = `pip pip-${pip.status}`
        let isActive = false
        if (pip.type === 'liberty' && pip.vertex)
          isActive = reviewVertex === `${pip.vertex[0]},${pip.vertex[1]}`
        else if (pip.type === 'comparison')
          isActive = reviewComp?.compIdx === pip.compIdx
        if (isActive) cls += ' pip-active'
        if (engine.finished) cls += ' pip-clickable'
        let gap = i > 0 && pip.type === 'comparison' && pips[i - 1].type === 'liberty'
        return <>
          {gap && <div class="pip-gap" />}
          <div key={i} class={cls} onClick={() => handleClick(pip)}>
            {pip.type === 'liberty' ? '?' : '\u2264'}
          </div>
        </>
      })}
    </div>
  )
}

export function computeStats(times, cap = 5000) {
  let capped = times.map(t => Math.min(t, cap))
  let avg = capped.length > 0 ? capped.reduce((a, b) => a + b, 0) / capped.length : 0
  let sd = capped.length > 1 ? Math.sqrt(capped.reduce((a, b) => a + (b - avg) ** 2, 0) / capped.length) : 0
  return { avg, sd }
}

function formatDate(ts) {
  let d = new Date(ts)
  let months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[d.getMonth()]} ${d.getDate()}`
}

function scoreLabel(s) {
  if (s.correct != null && s.total != null) return `${s.correct}/${s.total}`
  return `${Math.round(s.accuracy * 100)}%`
}

function StatsBar({ sgfId, onReplay }) {
  let scores = sgfId ? getScores(sgfId) : []
  let sorted = [...scores].sort((a, b) =>
    b.accuracy - a.accuracy || (a.totalMs || Infinity) - (b.totalMs || Infinity)
  )
  return (
    <div class="score-table-wrap">
      <table class="score-table">
        {sorted.map((s, i) => {
          let isLatest = s === scores[scores.length - 1]
          let hasReplay = sgfId && s.date && kv(`replay:${sgfId}:${s.date}`) != null
          return (
            <tr key={i} class={isLatest ? 'score-latest' : ''}>
              <td class="score-rank">{i + 1}.</td>
              <td class={`score-frac${s.accuracy >= 1 ? ' score-perfect' : ''}`}>{scoreLabel(s)}</td>
              <td class="score-time">{s.totalMs ? (s.totalMs / 1000).toFixed(1) + 's' : ''}</td>
              <td class="score-date">{s.date ? formatDate(s.date) : ''}</td>
              {hasReplay && <td class="score-replay">
                <button class="replay-btn" title="Watch replay of this attempt" onClick={(e) => { e.stopPropagation(); onReplay(s) }}>{'\u25B6'}</button>
              </td>}
            </tr>
          )
        })}
      </table>
    </div>
  )
}
