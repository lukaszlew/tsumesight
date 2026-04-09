import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { Goban } from '@sabaki/shudan'
import { QuizEngine } from './engine.js'
import { playCorrect, playWrong, playComplete, playStoneClick, playMark, resetStreak, isSoundEnabled, toggleSound } from './sounds.js'
import { kv, kvSet, kvRemove, getScores, addReplay, getReplay } from './db.js'
import config from './config.js'

function makeEmptyMap(size, fill = null) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

function transpose(map) {
  let rows = map.length
  let cols = map[0].length
  return Array.from({ length: cols }, (_, x) => Array.from({ length: rows }, (_, y) => map[y][x]))
}

import { computeStars, computeThreshold, nextStarGap } from './scoring.js'

function libLabel(n) {
  return n >= config.maxLibertyLabel ? config.maxLibertyLabel + '+' : String(n)
}

// Radial marking menu — angles in screen coords (0°=right/E, clockwise)
// Layout: S+SE+E = nomark (135°), then 1(SW) 2(W) 3(NW) 4(N) 5+(NE) at 45° each
const WHEEL_ZONES = [
  { value: 0, start: 337.5, end: 112.5, label: '' },
  { value: 1, start: 112.5, end: 157.5, label: '1' },
  { value: 2, start: 157.5, end: 202.5, label: '2' },
  { value: 3, start: 202.5, end: 247.5, label: '3' },
  { value: 4, start: 247.5, end: 292.5, label: '4' },
  { value: 5, start: 292.5, end: 337.5, label: '5+' },
]

function getWheelZone(dx, dy) {
  let angle = Math.atan2(dy, dx) * 180 / Math.PI
  if (angle < 0) angle += 360
  if (angle >= 112.5 && angle < 157.5) return 1
  if (angle >= 157.5 && angle < 202.5) return 2
  if (angle >= 202.5 && angle < 247.5) return 3
  if (angle >= 247.5 && angle < 292.5) return 4
  if (angle >= 292.5 && angle < 337.5) return 5
  return 0
}

function wheelPath(startDeg, endDeg, rInner, rOuter) {
  let toRad = Math.PI / 180
  let span = endDeg - startDeg
  if (span < 0) span += 360
  let large = span > 180 ? 1 : 0
  let s = startDeg * toRad
  let e = (startDeg + span) * toRad
  let x1i = rInner * Math.cos(s), y1i = rInner * Math.sin(s)
  let x1o = rOuter * Math.cos(s), y1o = rOuter * Math.sin(s)
  let x2i = rInner * Math.cos(e), y2i = rInner * Math.sin(e)
  let x2o = rOuter * Math.cos(e), y2o = rOuter * Math.sin(e)
  return [
    `M ${x1i} ${y1i}`, `L ${x1o} ${y1o}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2o} ${y2o}`,
    `L ${x2i} ${y2i}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x1i} ${y1i}`,
    'Z'
  ].join(' ')
}

function RadialMenu({ cx, cy, activeZone, vertexSize }) {
  let rOuter = vertexSize * 1.75
  let rInner = vertexSize * 0.4
  let rLabel = (rOuter + rInner) / 2
  let toRad = Math.PI / 180
  let pad = 2

  return (
    <svg style={{
      position: 'fixed',
      left: cx - rOuter - pad,
      top: cy - rOuter - pad,
      width: (rOuter + pad) * 2,
      height: (rOuter + pad) * 2,
      pointerEvents: 'none',
      zIndex: 1000,
    }} viewBox={`${-rOuter - pad} ${-rOuter - pad} ${(rOuter + pad) * 2} ${(rOuter + pad) * 2}`}>
      {WHEEL_ZONES.map(z => {
        let span = z.end - z.start
        if (span < 0) span += 360
        let midAngle = (z.start + span / 2) * toRad
        let lx = rLabel * Math.cos(midAngle)
        let ly = rLabel * Math.sin(midAngle)
        let active = activeZone === z.value
        return (
          <g key={z.value}>
            <path d={wheelPath(z.start, z.end, rInner, rOuter)}
              fill={active ? 'rgba(100, 200, 255, 0.5)' : z.value === 0 ? 'rgba(40, 40, 40, 0.3)' : 'rgba(70, 70, 70, 0.5)'}
              stroke="rgba(200, 200, 200, 0.6)"
              stroke-width={1}
            />
            {z.label && <text x={lx} y={ly} fill="white" font-size={vertexSize * 0.45}
              text-anchor="middle" dominant-baseline="central">
              {z.label}
            </text>}
          </g>
        )
      })}
    </svg>
  )
}

export function Quiz({ sgf, sgfId, quizKey, wasSolved, restored, onBack, onSolved, onUnsolved, onProgress, onLoadError, onNextUnsolved }) {
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
  // Feedback after Done press: null or array per changed group: {status, group, userVertex, userVal} | null
  let [libFeedback, setLibFeedback] = useState(null)
  // Finish popup: { elapsed, mistakes, total } or null
  let [finishPopup, setFinishPopup] = useState(null)
  let mistakesRef = useRef(0)

  // Radial marking menu state: { vertex, cx, cy, active } or null
  let [wheel, setWheel] = useState(null)
  let wheelRef = useRef(null) // mirror for global listeners
  let wheelUsedRef = useRef(false)

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

  // Initialize engine: restore finished state if solved, otherwise fresh
  if (!engineRef.current && !error) {
    resetStreak()
    try {
      if (wasSolved && restored) {
        let savedResults = kv(`results:${sgfId}`)
        if (savedResults) {
          let history = JSON.parse(savedResults)
          engineRef.current = QuizEngine.fromReplay(sgf, history, maxQ)
          solvedRef.current = true
        }
      }
      if (!engineRef.current) {
        engineRef.current = new QuizEngine(sgf, true, maxQ)
        if (config.autoShowFirstMove) {
          engineRef.current.advance()
          playStoneClick()
        }
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
      let elapsedMs = performance.now() - loadTimeRef.current
      let mistakes = mistakesRef.current
      let penaltyMs = mistakes * 3000
      let totalMs = elapsedMs + penaltyMs
      let date = Date.now()
      let thresholdMs = computeThreshold(engine)
      let scoreEntry = { correct: engine.correct, total, accuracy, totalMs: Math.round(totalMs), mistakes, thresholdMs, errors: engine.errors, date }
      addReplay(sgfId, date, replayEventsRef.current)
      kvSet(`results:${sgfId}`, JSON.stringify(engine.results))
      onSolved(engine.correct, total, scoreEntry)
      let stars = computeStars(totalMs, mistakes, thresholdMs)
      setFinishPopup({
        elapsed: Math.round(elapsedMs / 1000),
        mistakes,
        total: Math.round(totalMs / 1000),
        stars,
        gap: nextStarGap(totalMs, mistakes, thresholdMs),
      })
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
    setLibFeedback(null)
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
    setLibFeedback(null)
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
    setLibFeedback(null)
    setWrongFlash(false)
    setReplayProgress({ index: 0, total: events.length, elapsed: 0, totalMs: events[events.length - 1]?.t || 0 })
    setReplayFinished(false)
    setReplayAttempt(a => a + 1)
    rerender()
  }

  function exitReplayEarly() {
    restoreSavedState()
  }

  function startShowSequence(fresh = false) {
    // If already in sequence mode, restore before re-entering
    if (seqSavedRef.current) {
      engineRef.current = seqSavedRef.current.engine
    }
    if (fresh) {
      // Full restart: discard old state, reset scoring
      seqSavedRef.current = null
      solvedRef.current = false
      mistakesRef.current = 0
      loadTimeRef.current = performance.now()
      replayEventsRef.current = []
      replayStartRef.current = null
      setFinishPopup(null)
      resetStreak()
    } else {
      // Sequence replay: save state for restore
      seqSavedRef.current = { engine: engineRef.current, libMarks, libFeedback }
    }
    let tempEngine = new QuizEngine(sgf, true, maxQ)
    tempEngine.advance()
    engineRef.current = tempEngine
    setLibMarks(new Map())
    setLibFeedback(null)
    setWrongFlash(false)
    setSeqIdx(1)
    playStoneClick()
    rerender()
  }

  function exitShowSequence() {
    let saved = seqSavedRef.current
    seqSavedRef.current = null
    setSeqIdx(0)
    if (saved) {
      engineRef.current = saved.engine
      setLibMarks(saved.libMarks)
      setLibFeedback(saved.libFeedback)
    }
    rerender()
  }

  function advanceShowSequence() {
    let eng = engineRef.current
    if (eng.libertyExerciseActive || eng.finished) { exitShowSequence(); return }
    if (eng.showingMove) {
      eng.activateQuestions()
      if (eng.libertyExerciseActive || eng.finished) { exitShowSequence(); return }
      eng.advance()
      if (eng.showingMove) playStoneClick()
    } else if (!eng.finished) {
      eng.advance()
      if (eng.showingMove) playStoneClick()
    } else {
      exitShowSequence()
      return
    }
    rerender()
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
        setLibFeedback(null)
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

    let feedback = engine.checkLibertyExercise(libMarks)

    if (feedback.every(f => f.status === 'correct')) {
      recordEvent({ ex: Object.fromEntries(libMarks) })
      engine.submitLibertyExercise(libMarks)
      playCorrect()
      engine.advance()
      let total = engine.questionsPerMove.reduce((a, b) => a + b, 0)
      onProgress({ correct: engine.correct, done: engine.results.length, total })
      setLibFeedback(null)
      checkFinished()
    } else {
      mistakesRef.current += feedback.filter(f => f.status !== 'correct').length
      playWrong()
      setWrongFlash(true)
      setTimeout(() => setWrongFlash(false), 150)
      setLibFeedback(feedback)
    }
    rerender()
  }, [libMarks])

  // Commit a radial menu mark on a vertex
  let commitMark = useCallback((vertex, value) => {
    let key = `${vertex[0]},${vertex[1]}`
    let exercise = engine.libertyExercise
    if (!exercise) return
    let lockedGroup = exercise.groups.find(g => !g.changed && g.chainKeys.has(key))
    if (lockedGroup) return

    // Feedback mode: handle taps on checked groups
    if (libFeedback) {
      let changedGroups = exercise.groups.filter(g => g.changed)
      let feedbackIdx = changedGroups.findIndex(g => g.chainKeys.has(key))
      if (feedbackIdx !== -1) {
        let fb = libFeedback[feedbackIdx]
        if (fb?.status === 'correct') return
        if (fb) {
          recordEvent({ v: vertex })
          playMark(value)
          setLibMarks(prev => {
            let next = new Map(prev)
            for (let k of changedGroups[feedbackIdx].chainKeys) next.delete(k)
            if (value > 0) next.set(key, value)
            return next
          })
          setLibFeedback(prev => {
            let next = [...prev]
            next[feedbackIdx] = null
            return next.some(f => f !== null) ? next : null
          })
          return
        }
      }
    }

    recordEvent({ v: vertex })
    playMark(value)
    setLibMarks(prev => {
      let next = new Map(prev)
      if (value === 0) next.delete(key)
      else next.set(key, value)
      return next
    })
  }, [libMarks, libFeedback])

  let onVertexClick = useCallback((evt, vertex) => {
    if (wheelUsedRef.current) { wheelUsedRef.current = false; return }
    if (replayModeRef.current) { exitReplayEarly(); return }
    if (seqIdx > 0) { advanceShowSequence(); return }
    if (confirmExit) { setConfirmExit(false); return }
    if (engine.finished) return
    if (!engine.libertyExerciseActive) {
      recordEvent({ a: 1 })
      advance()
      return
    }
    // During liberty exercise, marking is handled by the radial menu
  }, [advance, seqIdx, confirmExit])

  let onVertexPointerDown = useCallback((evt, vertex) => {
    if (!engine.libertyExerciseActive) return
    // Get vertex center in screen coords
    let rect = evt.currentTarget.getBoundingClientRect()
    let cx = rect.left + rect.width / 2
    let cy = rect.top + rect.height / 2
    let dx = evt.clientX - cx
    let dy = evt.clientY - cy
    let dist = Math.sqrt(dx * dx + dy * dy)
    let vicinityThreshold = vertexSize * 0.4

    wheelUsedRef.current = true
    if (dist > vicinityThreshold) {
      // Fast flick — instant commit without showing wheel
      let zone = getWheelZone(dx, dy)
      commitMark(vertex, zone)
    } else {
      // Show wheel with initial zone from click offset
      let w = { vertex, cx, cy, active: getWheelZone(dx, dy) }
      wheelRef.current = w
      setWheel(w)
    }
  }, [vertexSize, commitMark])

  let onVertexPointerUp = useCallback(() => {}, [])

  // Global pointer listeners for wheel drag
  useEffect(() => {
    function onMove(evt) {
      let w = wheelRef.current
      if (!w) return
      evt.preventDefault() // prevent scroll during wheel drag
      let dx = evt.clientX - w.cx
      let dy = evt.clientY - w.cy
      let active = getWheelZone(dx, dy)
      if (active !== w.active) {
        w.active = active
        setWheel({ ...w })
      }
    }
    function onUp(evt) {
      let w = wheelRef.current
      if (!w) return
      wheelRef.current = null
      let dx = evt.clientX - w.cx
      let dy = evt.clientY - w.cy
      let zone = getWheelZone(dx, dy)
      commitMark(w.vertex, zone)
      setWheel(null)
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [vertexSize, commitMark])

  let tryBack = useCallback(() => {
    if (confirmExit || engine.finished) { onBack(); return }
    setConfirmExit(true)
  }, [confirmExit])

  let toggleSolved = useCallback(() => {
    if (wasSolved) {
      kvRemove(`results:${sgfId}`)
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
      else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        startShowSequence(engine.finished)
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
      let replayMarks = new Map()
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
            replayMarks = new Map()
            setLibMarks(new Map())
            eng.advance()
          }
        } else if (evt.v) {
          if (eng.libertyExerciseActive) {
            // Replay mark cycle on stone
            let key = `${evt.v[0]},${evt.v[1]}`
            let current = replayMarks.get(key) || 0
            let nextVal = current >= config.maxLibertyLabel ? 0 : current + 1
            playMark(nextVal)
            if (nextVal === 0) replayMarks.delete(key)
            else replayMarks.set(key, nextVal)
            setLibMarks(new Map(replayMarks))
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

  if (engine.finished && !replayMode && seqIdx === 0) {
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
            // Missed: show red "?" on representative vertex
            let [x, y] = g.vertex
            markerMap[y][x] = { type: 'label', label: '?' }
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

      if (libFeedback) {
        // Feedback mode: show green/red/? for checked groups
        let changedGroups = exercise.groups.filter(g => g.changed)
        for (let i = 0; i < changedGroups.length; i++) {
          let fb = libFeedback[i]
          let g = changedGroups[i]
          if (!fb) {
            // Cleared by tap: show user's current marks normally
            for (let k of g.chainKeys) {
              if (libMarks.has(k)) {
                let [mx, my] = k.split(',').map(Number)
                markerMap[my][mx] = { type: 'label', label: libLabel(libMarks.get(k)) }
              }
            }
          } else if (fb.status === 'correct') {
            let [mx, my] = fb.userVertex.split(',').map(Number)
            markerMap[my][mx] = { type: 'label', label: libLabel(fb.userVal) }
            paintMap[my][mx] = 1
          } else if (fb.status === 'wrong') {
            let [mx, my] = fb.userVertex.split(',').map(Number)
            markerMap[my][mx] = { type: 'label', label: libLabel(fb.userVal) }
            paintMap[my][mx] = -1
          } else {
            // missed
            let [x, y] = g.vertex
            markerMap[y][x] = { type: 'label', label: '?' }
            paintMap[y][x] = -1
          }
        }
      } else {
        // No feedback: show user marks normally
        for (let [key, val] of libMarks) {
          let [mx, my] = key.split(',').map(Number)
          markerMap[my][mx] = { type: 'label', label: libLabel(val) }
        }
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
  let handlePointerDown = rotated
    ? (evt, [x, y]) => onVertexPointerDown(evt, [y, x])
    : onVertexPointerDown
  let handlePointerUp = rotated
    ? (evt, [x, y]) => onVertexPointerUp(evt, [y, x])
    : onVertexPointerUp

  return (
    <div class="quiz">
      <div class="board-row" ref={boardRowRef}>
        {replayMode && <div class="replay-indicator">REPLAY</div>}
        <div class={`board-container${wrongFlash ? ' wrong-flash' : ''}${engine.finished && !replayMode ? ' finished' : ''}${libFeedback ? ' lib-feedback' : ''}${engine.showingMove ? ' showing-move' : ''}`}>
          {vertexSize > 0 && <Goban
            vertexSize={vertexSize}
            signMap={signMap}
            markerMap={markerMap}
            ghostStoneMap={ghostStoneMap}
            paintMap={paintMap}
            onVertexClick={handleVertexClick}
            onVertexPointerDown={handlePointerDown}
            onVertexPointerUp={handlePointerUp}
            rangeX={displayRangeX}
            rangeY={displayRangeY}
            showCoordinates={false}
            fuzzyStonePlacement={false}
            animateStonePlacement={false}
          />}
        </div>
        {wheel && <RadialMenu cx={wheel.cx} cy={wheel.cy} activeZone={wheel.active} vertexSize={vertexSize} />}
        {finishPopup && <div class="finish-popup">
          {finishPopup.stars === 5
            ? <div class="finish-trophy">🏆</div>
            : <div class="finish-stars">
                <span class="star-row">{'★★★'.split('').map((c, i) => <span key={i} class={i < Math.min(finishPopup.stars, 3) ? '' : 'star-off'}>{i < Math.min(finishPopup.stars, 3) ? '★' : '☆'}</span>)}</span>
                <span class="star-row star-row-bottom">{'★★'.split('').map((c, i) => <span key={i} class={i + 3 < finishPopup.stars ? '' : 'star-off'}>{i + 3 < finishPopup.stars ? '★' : '☆'}</span>)}</span>
              </div>
          }
          <div class="finish-time">{finishPopup.total}s</div>
          {finishPopup.mistakes > 0
            ? <div class="finish-detail">{finishPopup.elapsed}s + {finishPopup.mistakes * 3}s ({finishPopup.mistakes} {finishPopup.mistakes === 1 ? 'mistake' : 'mistakes'})</div>
            : null}
          {finishPopup.gap && <div class="finish-gap">{formatGap(finishPopup.gap)}</div>}
          <button class="finish-close" onClick={() => setFinishPopup(null)}>OK</button>
        </div>}
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
                    ? <div class="action-hint">{libFeedback
                        ? <>Tap red labels to fix, then <span class="hint-blue">Done</span></>
                        : <>Visualize hidden variation and tap groups to set liberty counts, then <span class="hint-blue">Done</span></>
                      }</div>
                    : !engine.finished
                      ? <div class="action-hint"><span class="hint-blue">Tap</span> board to advance. <span class="hint-blue">Remember</span> the variation. Move {engine.moveIndex}/{engine.totalMoves}.</div>
                      : null}
                  {engine.libertyExerciseActive && <button class="next-hero" title="Submit (Space/Enter)" onClick={submitExercise}>Done</button>}
                  {engine.finished && !replayMode && <StatsBar sgfId={sgfId} onReplay={startReplay} />}
                  <div class="bottom-bar-row">
                    <button class="bar-btn" title="Return to library (Esc)" onClick={tryBack}>&#x25C2; Back</button>
                    <button class="bar-btn" title={`Sound ${soundOn ? 'on' : 'off'}`} onClick={() => { setSoundOn(toggleSound()) }}>{soundOn ? '\uD83D\uDD0A' : '\uD83D\uDD07'}</button>
                    {preSolve && !engine.libertyExerciseActive && <button class="bar-btn mark-solved-btn" title={wasSolved ? 'Remove solved mark' : 'Skip and mark as solved (Enter)'} onClick={toggleSolved}>{wasSolved ? 'Mark as unsolved' : 'Mark as solved'}</button>}
                    {engine.finished && <button class="bar-btn eye-toggle" title={showSeqStones ? 'Hide sequence stones' : 'Show sequence stones'} onClick={() => setShowSeqStones(v => !v)}>{showSeqStones ? '\u{1F441}' : '\u{1F9E0}'}</button>}
                    <button class="bar-btn" title="Restart this problem (R)" onClick={() => startShowSequence(engine.finished)}>&#x21BB; Restart</button>
                    <button class={engine.finished ? 'next-hero' : 'bar-btn'} title="Next problem (Enter)" onClick={onNextUnsolved}>Next &#x25B8;</button>
                  </div>
                </>
        }
      </div>
    </div>
  )
}

function formatGap(gap) {
  let totalSec = (gap.deltaMs + gap.mistakesToRemove * 3000) / 1000
  let star = gap.nextStars === 5 ? '🏆' : `${gap.nextStars}★`
  return `${totalSec.toFixed(1)}s from ${star}`
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
