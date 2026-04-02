import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { Goban } from '@sabaki/shudan'
import { QuizEngine } from './engine.js'
import { playCorrect, playWrong, playComplete, playStoneClick, playMark, resetStreak, isSoundEnabled, toggleSound } from './sounds.js'
import { kv, kvRemove, getScores, addReplay, getReplay } from './db.js'
import config from './config.js'

function makeEmptyMap(size, fill = null) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

function transpose(map) {
  let rows = map.length
  let cols = map[0].length
  return Array.from({ length: cols }, (_, x) => Array.from({ length: rows }, (_, y) => map[y][x]))
}

function libLabel(n) {
  return n >= config.maxLibertyLabel ? config.maxLibertyLabel + '+' : String(n)
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
  let loadTimeRef = useRef(performance.now())
  let [wrongFlash, setWrongFlash] = useState(false)
  let [soundOn, setSoundOn] = useState(() => isSoundEnabled())
  let [showSeqStones, setShowSeqStones] = useState(false)
  let [confirmExit, setConfirmExit] = useState(false)

  // Liberty exercise state: Map<vertexKey, number> — user's label (1-5) per stone
  let [libMarks, setLibMarks] = useState(() => new Map())

  // Replay recording
  let replayEventsRef = useRef([])
  let replayStartRef = useRef(null)

  // Replay playback
  let [replayMode, setReplayMode] = useState(false)
  let replayModeRef = useRef(false)
  let replayDataRef = useRef(null)
  let savedEngineRef = useRef(null)
  let savedSolvedRef = useRef(false)
  let [replayProgress, setReplayProgress] = useState({ index: 0, total: 0, elapsed: 0, totalMs: 0 })
  let [replayFinished, setReplayFinished] = useState(false)
  let [replayAttempt, setReplayAttempt] = useState(0)

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
      if (config.autoShowFirstMove) {
        engineRef.current.advance()
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
    if (replayModeRef.current) return
    if (engine.finished && !solvedRef.current) {
      solvedRef.current = true
      let total = engine.results.length
      let accuracy = total > 0 ? engine.correct / total : 1
      let totalMs = performance.now() - loadTimeRef.current
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

    // Create fresh engine for replay
    try {
      engineRef.current = new QuizEngine(sgf, true, maxQ)
      engineRef.current.advance()
    } catch { return }

    // Reset transient state
    resetStreak()
    solvedRef.current = false
    setLibMarks(new Map())
    setWrongFlash(false)
    replayDataRef.current = events
    setReplayProgress({ index: 0, total: events.length, elapsed: 0, totalMs: events[events.length - 1]?.t || 0 })
    setReplayFinished(false)

    setReplayModeSync(true)
    rerender()
  }

  function restoreSavedState() {
    if (!savedEngineRef.current) return // guard against double-call
    setReplayModeSync(false)
    replayDataRef.current = null
    setLibMarks(new Map())
    setReplayFinished(false)
    setReplayProgress({ index: 0, total: 0, elapsed: 0, totalMs: 0 })
    // Restore saved engine and state
    engineRef.current = savedEngineRef.current
    solvedRef.current = savedSolvedRef.current
    savedEngineRef.current = null
    savedSolvedRef.current = false
    rerender()
  }

  function restartReplay() {
    let events = replayDataRef.current
    if (!events) return
    try {
      engineRef.current = new QuizEngine(sgf, true, maxQ)
      engineRef.current.advance()
    } catch { return }
    resetStreak()
    solvedRef.current = false
    setLibMarks(new Map())
    setWrongFlash(false)
    setReplayProgress({ index: 0, total: events.length, elapsed: 0, totalMs: events[events.length - 1]?.t || 0 })
    setReplayFinished(false)
    setReplayAttempt(a => a + 1)
    rerender()
  }

  function exitReplayEarly() {
    restoreSavedState()
  }

  function startShowSequence() {
    seqSavedRef.current = { libMarks }
    setSeqIdx(1)
  }

  function exitShowSequence() {
    let saved = seqSavedRef.current
    seqSavedRef.current = null
    setSeqIdx(0)
    if (saved) {
      setLibMarks(saved.libMarks)
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
    if (engine.finished || engine.libertyExerciseActive) return
    if (engine.showingMove) {
      engine.activateQuestions()
      if (!engine.libertyExerciseActive && !engine.finished) {
        engine.advance()
        if (engine.showingMove) playStoneClick()
      }
      if (engine.libertyExerciseActive) {
        setLibMarks(new Map())
      }
    } else {
      engine.advance()
      if (engine.showingMove) playStoneClick()
    }
    checkFinished()
    rerender()
  }, [])

  let submitExercise = useCallback(() => {
    if (!engine.libertyExerciseActive) return
    recordEvent({ ex: Object.fromEntries(libMarks) })
    let result = engine.submitLibertyExercise(libMarks)
    if (result.correctCount === result.total) playCorrect()
    engine.advance() // finish
    let total = engine.questionsPerMove.reduce((a, b) => a + b, 0)
    onProgress({ correct: engine.correct, done: engine.results.length, total })
    checkFinished()
    rerender()
  }, [libMarks])

  let onVertexClick = useCallback((evt, vertex) => {
    if (replayModeRef.current) { exitReplayEarly(); return }
    if (seqIdx > 0) { advanceShowSequence(); return }
    if (confirmExit) { setConfirmExit(false); return }
    let key = `${vertex[0]},${vertex[1]}`
    // Review mode: toggle review display on tap
    if (engine.finished) {
      return
    }
    // No exercise: tap = advance
    if (!engine.libertyExerciseActive) {
      recordEvent({ a: 1 })
      advance()
      return
    }
    // Liberty exercise: cycle label on stone (nomark → 1 → 2 → 3 → 4 → 5 → nomark)
    // Check if this stone belongs to a locked (unchanged) group
    let exercise = engine.libertyExercise
    let lockedGroup = exercise.groups.find(g => !g.changed && g.chainKeys.has(key))
    if (lockedGroup) return // locked, can't change

    recordEvent({ v: vertex })
    playMark()
    setLibMarks(prev => {
      let next = new Map(prev)
      let current = next.get(key) || 0
      let nextVal = current >= config.maxLibertyLabel ? 0 : current + 1
      if (nextVal === 0) next.delete(key)
      else next.set(key, nextVal)
      return next
    })
  }, [advance, libMarks, submitExercise])

  let tryBack = useCallback(() => {
    if (confirmExit || engine.finished) { onBack(); return }
    setConfirmExit(true)
  }, [confirmExit])

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
      if (e.key !== 'Escape') setConfirmExit(false)
      if (replayModeRef.current) {
        if (e.key === 'Escape') { e.preventDefault(); exitReplayEarly() }
        return
      }
      if (seqIdx > 0) {
        if (e.key === ' ') { e.preventDefault(); advanceShowSequence() }
        else if (e.key === 'Escape') { e.preventDefault(); exitShowSequence() }
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); tryBack() }
      else if (e.key === 'Enter') {
        e.preventDefault()
        if (engine.finished) onNextUnsolved()
        else if (engine.libertyExerciseActive) submitExercise()
        else if (preSolve) toggleSolved()
      }
      else if ((e.key === 'r' || e.key === 'R') && engine.finished) {
        e.preventDefault()
        onRetry()
      }
      else if (e.key === ' ') {
        e.preventDefault()
        if (engine.libertyExerciseActive) {
          submitExercise()
        }
        else if (!engine.finished) {
          recordEvent({ a: 1 })
          advance()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [advance, submitExercise])

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

        if (evt.ex) {
          // Exercise submission
          if (eng.libertyExerciseActive) {
            let marksPerPhase = new Map(Object.entries(evt.ex).map(([k, v]) => [k, v]))
            let result = eng.submitLibertyExercise(marksPerPhase)
            if (result.correctCount === result.total) playCorrect()
            else {
              playWrong()
              setWrongFlash(true)
              setTimeout(() => { if (!cancelled) setWrongFlash(false) }, 150)
            }
            setLibMarks(new Map())
            eng.advance()
          }
        } else if (evt.v) {
          if (eng.libertyExerciseActive) {
            // Replay mark cycle on stone
            let key = `${evt.v[0]},${evt.v[1]}`
            playMark()
            setLibMarks(prev => {
              let next = new Map(prev)
              let current = next.get(key) || 0
              let nextVal = current >= config.maxLibertyLabel ? 0 : current + 1
              if (nextVal === 0) next.delete(key)
              else next.set(key, nextVal)
              return next
            })
          } else if (!eng.finished) {
            if (eng.showingMove) {
              eng.activateQuestions()
              if (!eng.libertyExerciseActive && !eng.finished) {
                eng.advance()
                if (eng.showingMove) playStoneClick()
              }
            } else {
              eng.advance()
              if (eng.showingMove) playStoneClick()
            }
          }
        } else if (evt.a) {
          if (!eng.finished && !eng.libertyExerciseActive) {
            if (eng.showingMove) {
              eng.activateQuestions()
              if (!eng.libertyExerciseActive && !eng.finished) {
                eng.advance()
                if (eng.showingMove) playStoneClick()
              }
            } else {
              eng.advance()
              if (eng.showingMove) playStoneClick()
            }
          }
        }

        if (!cancelled) {
          setReplayProgress({ index: i + 1, total: events.length, elapsed: events[i].t, totalMs: events[events.length - 1]?.t || 0 })
          rerender()
        }
      }

      // Replay finished — pause on final state until user dismisses
      if (!cancelled) {
        setReplayFinished(true)
      }
    }

    play()
    return () => { cancelled = true }
  }, [replayMode, replayAttempt])

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
    signMap = (showSeqStones ? engine.trueBoard.signMap : engine.initialBoard.signMap).map(row => [...row])
    markerMap = makeEmptyMap(size)
    ghostStoneMap = makeEmptyMap(size)
    paintMap = makeEmptyMap(size, 0)

    // Show lib count labels on all groups with correct/wrong coloring
    let exercise = engine.libertyExercise
    if (exercise) {
      let userMarks = exercise.userMarks || new Map()
      let moveIdx = engine.moveProgress.length - 1
      let asked = engine.questionsAsked[moveIdx] || []
      let changedIdx = 0

      for (let g of exercise.groups) {
        if (!g.changed) {
          // Pre-marked: show on representative vertex, neutral color
          let [x, y] = g.vertex
          markerMap[y][x] = { type: 'label', label: libLabel(g.libCount) }
        } else {
          let correct = asked[changedIdx]?.markedCorrectly
          changedIdx++

          // Find which vertex the user marked in this group
          let userVertex = null
          let userVal = null
          for (let k of g.chainKeys) {
            if (userMarks.has(k)) { userVertex = k; userVal = userMarks.get(k); break }
          }

          if (userVertex !== null) {
            // User marked: show their label, green if correct, red if wrong
            let [mx, my] = userVertex.split(',').map(Number)
            markerMap[my][mx] = { type: 'label', label: libLabel(userVal) }
            paintMap[my][mx] = correct ? 1 : -1
          } else {
            // Missed: show correct number on representative vertex, red
            let [x, y] = g.vertex
            markerMap[y][x] = { type: 'label', label: libLabel(g.libCount) }
            paintMap[y][x] = -1
          }
        }
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
      for (let { sign, vertex, moveNumber } of engine.getWindowStones()) {
        let [wx, wy] = vertex
        signMap[wy][wx] = sign
        markerMap[wy][wx] = { type: 'label', label: String(moveNumber) }
      }
    }

    // Liberty exercise: show labels on stones
    if (engine.libertyExerciseActive) {
      let exercise = engine.libertyExercise
      // Pre-marked (locked) groups
      for (let g of exercise.groups) {
        if (g.changed) continue
        let [x, y] = g.vertex
        markerMap[y][x] = { type: 'label', label: libLabel(g.libCount) }
      }
      // User marks
      for (let [key, val] of libMarks) {
        let [mx, my] = key.split(',').map(Number)
        markerMap[my][mx] = { type: 'label', label: libLabel(val) }
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

  return (
    <div class="quiz">
      <div class="board-row" ref={boardRowRef}>
        {replayMode && <div class="replay-indicator">REPLAY</div>}
        {seqIdx > 0 && <div class="replay-indicator">SEQUENCE</div>}
        <div class={`board-container${wrongFlash ? ' wrong-flash' : ''}${engine.finished && !replayMode ? ' finished' : ''}`}>
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

      <div class="bottom-bar">
        {replayMode
          ? <>
              <div class="replay-progress-wrap">
                <span class="replay-timer">{(replayProgress.elapsed / 1000).toFixed(1)}s</span>
                <div class="replay-progress-bar">
                  <div class="replay-progress-fill" style={{ width: `${replayProgress.totalMs > 0 ? (replayProgress.elapsed / replayProgress.totalMs * 100) : 0}%` }} />
                </div>
              </div>
              <div class="replay-exit-hint">{replayFinished ? 'Replay complete. Tap board or press Esc to exit.' : 'Tap board or press Esc to exit'}</div>
              <div class="bottom-bar-row">
                <button class="bar-btn" title="Restart replay" onClick={restartReplay}>Restart</button>
                <button class="bar-btn" title="Exit replay (Esc)" onClick={exitReplayEarly}>Exit</button>
              </div>
            </>
          : seqIdx > 0
            ? <div class="replay-exit-hint">Move {seqIdx}/{engine.moveIndex} — tap to advance</div>
            : confirmExit
              ? <>
                  <div class="action-hint">Exit this problem?</div>
                  <div class="bottom-bar-row">
                    <button class="bar-btn" onClick={() => setConfirmExit(false)}>Cancel</button>
                    <button class="next-hero" onClick={onBack}>Exit</button>
                  </div>
                </>
              : <>
                  {engine.libertyExerciseActive
                    ? <div class="action-hint">Tap stones to label liberty counts, then <span class="hint-blue">Done</span></div>
                    : !engine.finished
                      ? <div class="action-hint">Tap board for the next move{engine.showingMove ? '. Remember the sequence.' : ''}</div>
                      : null}
                  {engine.libertyExerciseActive && <button class="next-hero" title="Submit (Space/Enter)" onClick={submitExercise}>Done</button>}
                  {engine.finished && !replayMode && <StatsBar sgfId={sgfId} onReplay={startReplay} />}
                  <div class="bottom-bar-row">
                    <button class="bar-btn" title="Return to library (Esc)" onClick={tryBack}>&#x25C2; Back</button>
                    <button class="bar-btn" title={`Sound ${soundOn ? 'on' : 'off'}`} onClick={() => { setSoundOn(toggleSound()) }}>{soundOn ? '\uD83D\uDD0A' : '\uD83D\uDD07'}</button>
                    {engine.libertyExerciseActive && <button class="bar-btn" title="Replay the move sequence" onClick={startShowSequence}>&#x25B6; Replay</button>}
                    {preSolve && !engine.libertyExerciseActive && <button class="bar-btn mark-solved-btn" title={wasSolved ? 'Remove solved mark' : 'Skip and mark as solved (Enter)'} onClick={toggleSolved}>{wasSolved ? 'Mark as unsolved' : 'Mark as solved'}</button>}
                    {engine.finished && <button class="bar-btn" title={showSeqStones ? 'Hide sequence stones' : 'Show sequence stones'} onClick={() => setShowSeqStones(v => !v)}>{showSeqStones ? '\u25CB' : '\u25CF'}</button>}
                    {engine.finished && <button class="bar-btn" title="Restart this problem (R)" onClick={onRetry}>Retry</button>}
                    {engine.finished && <button class="next-hero" title="Next unsolved problem (Enter)" onClick={onNextUnsolved}>Next</button>}
                  </div>
                </>
        }
      </div>
    </div>
  )
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
          let hasReplay = sgfId && s.date && getReplay(sgfId, s.date) != null
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
