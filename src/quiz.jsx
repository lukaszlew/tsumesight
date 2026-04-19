import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks'
import { Goban } from '@sabaki/shudan'
import {
  init, step, phase, finalized, isLockedVertex,
  changedGroups, mistakesByGroup, totalMistakes, pointsByGroup,
} from './session.js'
import { playCorrect, playWrong, playComplete, playStoneClick, playMark, resetStreak, isSoundEnabled, toggleSound } from './sounds.js'
import { kv, kvSet, getScores, addReplay, getLatestReplay } from './db.js'
import config from './config.js'
import { computeStars, computeParScore, computeAccPoints, computeSpeedPoints, StarsDisplay } from './scoring.js'

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

// Decide board orientation and vertex size that fit a puzzle of cols x rows
// in an availW x availH rectangle. Pure function — exported for testing.
export function pickBoardLayout(availW, availH, cols, rows) {
  let normalSize = Math.floor(Math.min(availW / (cols + 0.5), availH / (rows + 0.5)))
  let rotatedSize = Math.floor(Math.min(availW / (rows + 0.5), availH / (cols + 0.5)))
  let rotated = rotatedSize > normalSize * 1.1
  return { rotated, vertexSize: Math.max(1, rotated ? rotatedSize : normalSize) }
}

// Radial marking menu — angles in screen coords (0°=right/E, clockwise)
// 6 arrows at 60° intervals. Going clockwise from straight up:
// nomark(N), 1(NNE), 2(ESE), 3(S), 4(SSW), 5+(WNW). 3 points straight down.
const WHEEL_ZONES = [
  { value: 0, angle: 270, label: '' },
  { value: 1, angle: 330, label: '1' },
  { value: 2, angle: 30,  label: '2' },
  { value: 3, angle: 90,  label: '3' },
  { value: 4, angle: 150, label: '4' },
  { value: 5, angle: 210, label: '5+' },
]

function getWheelZone(dx, dy) {
  let angle = Math.atan2(dy, dx) * 180 / Math.PI
  if (angle < 0) angle += 360
  let shifted = (angle - 240 + 360) % 360
  return Math.floor(shifted / 60)
}

function RadialMenu({ cx, cy, activeZone, vertexSize, boardHeight }) {
  let maxDiameter = Math.min(window.innerWidth * 0.5, boardHeight * 0.5)
  let unit = maxDiameter / 6.7
  let rInner = unit * 0.6
  let rOuter = unit * 2
  let rLabel = rOuter + unit * 0.55
  let shaftW = unit * 0.25
  let headW = unit * 0.6
  let headLen = unit * 0.7
  let strokeW = unit * 0.04
  let toRad = Math.PI / 180
  let size = rLabel + unit * 0.8

  let shaftEnd = rOuter - headLen
  let arrowPoints = [
    `${rInner},${-shaftW / 2}`,
    `${shaftEnd},${-shaftW / 2}`,
    `${shaftEnd},${-headW / 2}`,
    `${rOuter},0`,
    `${shaftEnd},${headW / 2}`,
    `${shaftEnd},${shaftW / 2}`,
    `${rInner},${shaftW / 2}`,
  ].join(' ')

  return (
    <svg style={{
      position: 'fixed',
      left: cx - size,
      top: cy - size,
      width: size * 2,
      height: size * 2,
      pointerEvents: 'none',
      zIndex: 1000,
      overflow: 'visible',
    }} viewBox={`${-size} ${-size} ${size * 2} ${size * 2}`}>
      <circle cx={0} cy={0} r={rLabel + vertexSize * 0.5} fill="rgba(255, 255, 255, 0.65)" />
      {WHEEL_ZONES.map(z => {
        let rad = z.angle * toRad
        let lx = Math.cos(rad) * rLabel
        let ly = Math.sin(rad) * rLabel
        let active = activeZone === z.value
        let fill = active ? '#4bf' : '#fff'
        return (
          <g key={z.value}>
            <polygon points={arrowPoints} fill={fill}
              stroke="#000" stroke-width={strokeW} stroke-linejoin="round"
              transform={`rotate(${z.angle})`} />
            {z.label && <text x={lx} y={ly} fill={fill}
              font-size={unit * 0.95} font-weight="800"
              text-anchor="middle" dominant-baseline="central"
              style={{ paintOrder: 'stroke' }}
              stroke="#000" stroke-width={strokeW}>
              {z.label}
            </text>}
          </g>
        )
      })}
    </svg>
  )
}

export function Quiz({ sgf, sgfId, quizKey, wasSolved, restored, onBack, onSolved, onProgress, onLoadError, onNextUnsolved, onPrev, onNext }) {
  let [maxQ] = useState(() => parseInt(kv('quizMaxQ', '2')))
  let sessionConfig = useMemo(() => ({ maxSubmits: config.maxSubmits, maxQuestions: maxQ }), [maxQ])

  // Initial events: if reopening a solved puzzle, fold its stored replay.
  // Otherwise start fresh. This is the P2 shape; once P2.5 lands, kv
  // persistence per-event makes abandoned sessions recoverable too.
  let [initState] = useState(() => {
    let events = []
    let autoSolved = false
    if (wasSolved && restored) {
      let record = getLatestReplay(sgfId)
      if (record?.events?.length > 0) {
        events = record.events
        autoSolved = true
      }
    }
    return { events, autoSolved }
  })

  let [error, setError] = useState(null)

  // events is the append-only source of truth for the session. Fold through
  // step() to derive the current session state. useMemo caches per-events.
  let [events, setEvents] = useState(initState.events)
  let state = useMemo(() => {
    try {
      let s = init(sgf, sessionConfig)
      for (let e of events) step(s, e)
      return s
    } catch (e) {
      setError(e.message)
      return null
    }
  }, [events, sgf, sessionConfig])

  // Refs that track progress through the event stream for side effects.
  // Seeded to "already caught up to initial events" so review-mode mounts
  // (solved puzzle reopen) don't re-play sounds.
  let solvedRef = useRef(initState.autoSolved)
  let lastEventIdxRef = useRef(initState.events.length - 1)
  let prevSubmitCountRef = useRef(0)
  let startTimeRef = useRef(null)
  let loadTimeRef = useRef(performance.now())
  // Key under which the live event log is persisted in kv. Set lazily on
  // first dispatch so review-mode mounts don't create a spurious session
  // record. On finalize, the enriched replay is written to `replay:*`
  // via addReplay; this session:* key stays in place as raw history.
  let sessionKeyRef = useRef(null)
  // Layout + UI-only state (not session state)
  let [vertexSize, setVertexSize] = useState(0)
  let [rotated, setRotated] = useState(false)
  let boardRowRef = useRef(null)
  let bottomBarRef = useRef(null)
  let [wrongFlash, setWrongFlash] = useState(false)
  let [soundOn, setSoundOn] = useState(() => isSoundEnabled())
  let [showSeqStones, setShowSeqStones] = useState(false)
  let [confirmExit, setConfirmExit] = useState(false)
  let [finishPopup, setFinishPopup] = useState(null)

  // Radial marking menu state: { vertex, cx, cy, active } or null
  let [wheel, setWheel] = useState(null)
  let wheelRef = useRef(null)
  let wheelUsedRef = useRef(false)

  // Seed prevSubmitCount from the initial fold (so review-mode mounts don't
  // trigger submit effects). Runs exactly once on mount.
  useEffect(() => {
    if (state) prevSubmitCountRef.current = state.submitCount
    // Auto-advance on first load unless restoring a solved puzzle.
    // config.autoShowFirstMove is currently false; branch kept for parity.
    if (!initState.autoSolved && config.autoShowFirstMove && events.length === 0) {
      dispatch({ kind: 'advance' })
    }
    resetStreak()
  }, [])

  // Dispatch: append an event. Sets t relative to the first event's time.
  // First dispatch also pins the session kv key so the live event log
  // survives a reload.
  function dispatch(evt) {
    if (startTimeRef.current == null) {
      startTimeRef.current = performance.now()
      sessionKeyRef.current = `session:${sgfId}:${Date.now()}`
    }
    let t = evt.t ?? Math.round(performance.now() - startTimeRef.current)
    setEvents(e => [...e, { ...evt, t }])
  }

  // Eager persistence: on every events change, mirror the full log into
  // kv. Review-mode sessions (autoSolved) skip this — they'd just
  // duplicate an already-finalized replay.
  useEffect(() => {
    if (initState.autoSolved) return
    if (!sessionKeyRef.current) return
    if (events.length === 0) return
    kvSet(sessionKeyRef.current, JSON.stringify(events))
  }, [events])

  // Per-event sound effects. Walks from lastEventIdxRef to the current end.
  useEffect(() => {
    if (!state) return
    let n = state.events.length
    while (lastEventIdxRef.current < n - 1) {
      let idx = ++lastEventIdxRef.current
      let evt = state.events[idx]
      if (evt.kind === 'setMark') playMark(evt.value)
      // advance sound is handled in dispatchAdvance (predictive on pre-state)
      // submit sounds are handled by the submit effect below (needs post-state)
    }
  }, [state?.events])

  // Submit effects: post-submit sound + wrong flash + onProgress on finalize.
  useEffect(() => {
    if (!state) return
    if (state.submitCount <= prevSubmitCountRef.current) return
    prevSubmitCountRef.current = state.submitCount
    let lastResult = state.submitResults.at(-1) || []
    let allCorrect = lastResult.every(r => r.status === 'correct')
    if (finalized(state)) {
      if (allCorrect) playCorrect(); else playWrong()
      let total = changedGroups(state).length
      let wrongCount = mistakesByGroup(state).filter(m => m > 0).length
      onProgress({
        correct: allCorrect ? total : total - wrongCount,
        done: total,
        total,
      })
    } else {
      playWrong()
      setWrongFlash(true)
      setTimeout(() => setWrongFlash(false), 150)
    }
  }, [state?.submitCount])

  // Finalize effect: compute scoring, write enriched replay, show popup,
  // play completion sound. Runs exactly once per session (gated on
  // solvedRef) when state transitions to 'finished'.
  useEffect(() => {
    if (!state) return
    if (phase(state) !== 'finished' || solvedRef.current) return
    solvedRef.current = true
    let groups = changedGroups(state)
    let groupCount = groups.length
    let mistakes = totalMistakes(state)
    let mbg = mistakesByGroup(state)
    let elapsedMs = Math.round(performance.now() - loadTimeRef.current)
    // Cup time: base 3s + 1.5s per move + 1.5s per group.
    let cupMs = (3 + state.totalMoves * 1.5 + groupCount * 1.5) * 1000
    let parScore = computeParScore(groupCount, cupMs)
    let accPoints = computeAccPoints(mistakes, groupCount)
    let speedPoints = computeSpeedPoints(elapsedMs, cupMs)
    let stars = computeStars(accPoints, speedPoints, mistakes, parScore)

    // Order per-group points by displayed board position (left-to-right, top-to-bottom).
    let displayIdx = groups.map((g, i) => i).sort((a, b) => {
      let va = groups[a].vertex, vb = groups[b].vertex
      let ax = rotated ? va[1] : va[0], ay = rotated ? va[0] : va[1]
      let bx = rotated ? vb[1] : vb[0], by = rotated ? vb[0] : vb[1]
      return ax - bx || ay - by
    })
    let orderedPointsByGroup = displayIdx.map(i => pointsByGroup(mbg)[i])

    let correct = Math.max(0, groupCount - mistakes)
    let total = groupCount
    let accuracy = total > 0 ? correct / total : 1
    let date = Date.now()
    let scoreEntry = {
      correct, total, accuracy,
      totalMs: elapsedMs, mistakes, errors: mistakes, date,
      thresholdMs: cupMs, cupMs, parScore, accPoints, speedPoints, groupCount, mistakesByGroup: mbg,
    }
    // v:3 enriched record. Matches the fixture schema (src/fixture-schema.js)
    // so the converter can promote this into a committed test fixture.
    let finalMarks = [...state.marks.entries()].map(([key, m]) => ({ key, value: m.value, color: m.color }))
    let changedGroupsVertices = groups.map(g => g.vertex)
    addReplay(sgfId, date, {
      events: state.events,
      config: sessionConfig,
      viewport: { w: window.innerWidth, h: window.innerHeight, rotated },
      goldens: {
        scoreEntry,
        finalMarks,
        submitResults: state.submitResults,
        changedGroupsVertices,
      },
    })
    onSolved(correct, total, scoreEntry)
    setFinishPopup({
      elapsedSec: Math.round(elapsedMs / 1000),
      mistakes, accPoints, speedPoints, stars, parScore,
      pointsByGroup: orderedPointsByGroup,
      maxGroups: 10 * groupCount,
      maxSpeed: Math.round(2 * (cupMs / 1000)),
    })
    playComplete(stars)
  }, [state])

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

  if (!state) return null  // mid-init error; will be handled on next render

  let inExercise = phase(state) === 'exercise'
  let isFinished = phase(state) === 'finished'

  function dispatchAdvance() {
    if (phase(state) !== 'showing') return
    // Predict: if we're pre-last-move, the advance plays a stone click.
    // If cursor === totalMoves, advance activates the exercise (no sound).
    let willClick = state.cursor < state.totalMoves
    dispatch({ kind: 'advance' })
    if (willClick) playStoneClick()
  }

  function dispatchSubmit() {
    if (!inExercise) return
    if (state.marks.size === 0) return
    dispatch({ kind: 'submit' })
    // Sound + wrong-flash + onProgress + finalize handled in useEffects.
  }

  let commitMark = useCallback((vertex, value) => {
    if (!inExercise) return
    dispatch({ kind: 'setMark', vertex, value })
  }, [inExercise])

  function doRewind() {
    if (isFinished) return
    dispatch({ kind: 'rewind' })
    if (config.autoShowFirstMove) {
      dispatch({ kind: 'advance' })
      playStoneClick()
    }
  }

  function doRestart() {
    solvedRef.current = false
    lastEventIdxRef.current = -1
    prevSubmitCountRef.current = 0
    startTimeRef.current = null
    loadTimeRef.current = performance.now()
    setFinishPopup(null)
    setWrongFlash(false)
    resetStreak()
    if (config.autoShowFirstMove) {
      startTimeRef.current = performance.now()
      setEvents([{ kind: 'advance', t: 0 }])
      playStoneClick()
    } else {
      setEvents([])
    }
  }

  let onVertexClick = useCallback((evt, vertex) => {
    if (wheelUsedRef.current) { wheelUsedRef.current = false; return }
    if (confirmExit) { setConfirmExit(false); return }
    if (phase(state) === 'showing') {
      dispatchAdvance()
      return
    }
    // Exercise: marking handled by radial menu (pointer events)
  }, [state, confirmExit])

  let onVertexPointerDown = useCallback((evt, vertex) => {
    if (!inExercise) return
    if (isLockedVertex(state, vertex)) return  // pre-marked (non-editable) label
    // Claim the pointer so Android suppresses its long-press gesture.
    try { evt.currentTarget.setPointerCapture(evt.pointerId) } catch {}
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
      commitMark(vertex, getWheelZone(dx, dy))
    } else {
      // Show wheel opposite vertically so the finger doesn't cover it.
      let boardEl = evt.currentTarget.closest('.shudan-goban') || boardRowRef.current
      let board = boardEl.getBoundingClientRect()
      let my = board.top + board.height / 2
      let clickedTop = cy < my
      let wcx = board.left + board.width / 2
      let wcy = clickedTop ? board.top + board.height * 3 / 4 : board.top + board.height / 4
      let w = { vertex, cx, cy, wcx, wcy, boardHeight: board.height, active: getWheelZone(dx, dy) }
      wheelRef.current = w
      setWheel(w)
    }
  }, [vertexSize, commitMark, state, inExercise])

  let onVertexPointerUp = useCallback(() => {}, [])

  useEffect(() => {
    function onMove(evt) {
      let w = wheelRef.current
      if (!w) return
      evt.preventDefault()
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
      commitMark(w.vertex, getWheelZone(dx, dy))
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
    if (confirmExit || isFinished) { onBack(); return }
    setConfirmExit(true)
  }, [confirmExit, isFinished])

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      if (e.repeat) return
      if (e.key !== 'Escape') setConfirmExit(false)

      if (e.key === 'Escape') { e.preventDefault(); tryBack() }
      else if (e.key === 'Enter') {
        e.preventDefault()
        if (isFinished) onNextUnsolved()
        else if (inExercise) dispatchSubmit()
      }
      else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        if (isFinished) doRestart()
        else doRewind()
      }
      else if (e.key === ' ') {
        e.preventDefault()
        if (inExercise) dispatchSubmit()
        else if (phase(state) === 'showing') dispatchAdvance()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // Layout computation
  let engine = state.engine
  let rangeX = engine.boardRange ? [engine.boardRange[0], engine.boardRange[2]] : undefined
  let rangeY = engine.boardRange ? [engine.boardRange[1], engine.boardRange[3]] : undefined
  let cols = rangeX ? rangeX[1] - rangeX[0] + 1 : engine.boardSize
  let rows = rangeY ? rangeY[1] - rangeY[0] + 1 : engine.boardSize
  useEffect(() => {
    let el = boardRowRef.current
    let bb = bottomBarRef.current
    let quiz = el?.parentElement
    if (!el || !quiz) return
    let recompute = () => {
      let qStyle = getComputedStyle(quiz)
      let pl = parseFloat(qStyle.paddingLeft) || 0
      let pr = parseFloat(qStyle.paddingRight) || 0
      let pt = parseFloat(qStyle.paddingTop) || 0
      let availW = quiz.clientWidth - pl - pr
      let availH = quiz.clientHeight - pt - (bb ? bb.getBoundingClientRect().height : 0)
      availH = Math.min(availH, window.innerHeight * 0.7)
      if (availW <= 0 || availH <= 0) return
      let { rotated: useRotated, vertexSize: vs } = pickBoardLayout(availW, availH, cols, rows)
      let displayCols = useRotated ? rows : cols
      let displayRows = useRotated ? cols : rows
      el.style.width = (displayCols + 0.5) * vs + 'px'
      el.style.height = (displayRows + 0.5) * vs + 'px'
      setRotated(useRotated)
      setVertexSize(vs)
    }
    let ro = new ResizeObserver(recompute)
    ro.observe(quiz)
    if (bb) ro.observe(bb)
    return () => ro.disconnect()
  }, [cols, rows])

  // Build display maps
  let size = engine.boardSize
  let signMap, markerMap, ghostStoneMap, paintMap

  if (isFinished && state.hasExercise) {
    // Final review: show all stones or initial position (eye toggle).
    signMap = (showSeqStones ? engine.trueBoard.signMap : engine.initialBoard.signMap).map(row => [...row])
  } else {
    signMap = engine.getDisplaySignMap()
  }
  markerMap = makeEmptyMap(size)
  ghostStoneMap = makeEmptyMap(size)
  paintMap = makeEmptyMap(size, 0)

  // Show phase: opaque stone with move number for the just-played move.
  if (!isFinished && engine.currentMove && engine.showingMove) {
    let [x, y] = engine.currentMove.vertex
    signMap[y][x] = engine.currentMove.sign
    markerMap[y][x] = { type: 'label', label: String(engine.moveIndex) }
  }

  // Pre-marked (unchanged) groups show their fixed liberty count. Shown
  // during both exercise and finished review.
  let exercise = engine.libertyExercise
  if ((inExercise || isFinished) && exercise) {
    for (let g of exercise.groups) {
      if (g.changed) continue
      let [x, y] = g.vertex
      markerMap[y][x] = { type: 'label', label: libLabel(g.libCount) }
    }
  }

  // All user/eval marks live in state.marks with shape {value, color}.
  // Render them directly — no separate feedback overlay. Eval colors appear
  // after Done; user's next tap at the same intersection clears that color.
  if (inExercise || isFinished) {
    for (let [key, mark] of state.marks) {
      let [mx, my] = key.split(',').map(Number)
      let label = mark.value === '?' ? '?' : libLabel(mark.value)
      markerMap[my][mx] = { type: 'label', label }
      if (mark.color === 'green') paintMap[my][mx] = 1
      else if (mark.color === 'red') paintMap[my][mx] = -1
    }
  }

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

  let hasMarks = state.marks.size > 0
  let showingMoveClass = phase(state) === 'showing' && engine.showingMove ? ' showing-move' : ''
  let hasEvalColors = [...state.marks.values()].some(m => m.color)
  let feedbackClass = hasEvalColors && inExercise ? ' lib-feedback' : ''

  return (
    <div class="quiz">
      <div class="board-row" ref={boardRowRef}>
        <div class={`board-container${wrongFlash ? ' wrong-flash' : ''}${isFinished ? ' finished' : ''}${feedbackClass}${showingMoveClass}`}>
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
        {finishPopup && <div class="finish-popup">
          <StarsDisplay stars={finishPopup.stars} wrapClass="finish-stars" trophyClass="finish-trophy" medalClass="finish-medal" offClass="star-off" />
          <div class="finish-total">{finishPopup.accPoints + finishPopup.speedPoints} points</div>
          <table class="finish-breakdown"><tbody>
            <tr>
              <td class="b-label">groups:</td>
              <td class="b-total-col"><span class="b-total">{finishPopup.accPoints}</span></td>
              <td class="b-eq">=</td>
              <td class="b-sum">
                {(() => {
                  let counts = [
                    { n: finishPopup.pointsByGroup.filter(p => p === 10).length, v: 10, cls: 'b-num', cntCls: 'b-count-good' },
                    { n: finishPopup.pointsByGroup.filter(p => p === 5).length, v: 5, cls: 'b-num', cntCls: 'b-count-bad' },
                    { n: finishPopup.pointsByGroup.filter(p => p === 0).length, v: 0, cls: 'b-zero', cntCls: 'b-count-bad' },
                  ].filter(c => c.n > 0)
                  return counts.map((c, i) => <span key={i}>
                    {i > 0 && <span class="b-plus"> + </span>}
                    <span class={c.cls}>{c.v}</span><span class="b-times">×</span><span class={c.cntCls}>{c.n}</span>
                  </span>)
                })()}
                <span class="b-unit"> (max {finishPopup.maxGroups})</span>
              </td>
            </tr>
            <tr>
              <td class="b-label">time:</td>
              <td class="b-total-col"><span class="b-total">{finishPopup.speedPoints}</span></td>
              <td class="b-eq">=</td>
              <td class="b-sum">
                <span class="b-num">{finishPopup.maxSpeed}</span><span class="b-unit"> (max)</span>
                <span class="b-eq"> − </span>
                <span class="b-count">{finishPopup.elapsedSec}</span><span class="b-unit">s</span>
              </td>
            </tr>
          </tbody></table>
          <table class="finish-thresholds"><tbody>
            <tr class="thresh-points">{[1.0, 0.75, 0.50, 0.25, 0].map((f, i) => <td key={i} class={finishPopup.stars === 5 - i ? 'reached' : ''}>{Math.ceil(f * finishPopup.parScore)}</td>)}</tr>
            <tr class="thresh-reward">{['🏆', '🏅', '★★★', '★★', '★'].map((label, i) => <td key={i} class={finishPopup.stars === 5 - i ? 'reached' : ''}>{label}</td>)}</tr>
          </tbody></table>
          <button class="finish-close" onClick={() => setFinishPopup(null)}>OK</button>
        </div>}
      </div>
      {wheel && <RadialMenu cx={wheel.wcx} cy={wheel.wcy} activeZone={wheel.active} vertexSize={vertexSize} boardHeight={wheel.boardHeight} />}

      <div class="bottom-bar" ref={bottomBarRef}>
        {confirmExit
          ? <>
              <div class="action-hint">Exit this problem?</div>
              <div class="bottom-bar-row">
                <button class="bar-btn" onClick={() => setConfirmExit(false)}>Cancel</button>
                <button class="next-hero" onClick={onBack}>Exit</button>
              </div>
            </>
          : <>
              {inExercise
                ? <button class={`next-hero${hasMarks ? '' : ' next-hero-hidden'}`} title="Submit (Space/Enter)" onClick={dispatchSubmit}>
                    {hasMarks ? 'Done' : 'Press and swipe each group to set its liberty count'}
                  </button>
                : phase(state) === 'showing'
                  ? <div class="action-hint"><span class="hint-blue">Tap</span> board to advance. <span class="hint-blue">Remember</span> the variation. Move {state.cursor}/{state.totalMoves}.</div>
                  : null}
              {isFinished && <StatsBar sgfId={sgfId} />}
              <div class="bottom-bar-row">
                <button class="bar-btn nav-btn" title={`Sound ${soundOn ? 'on' : 'off'}`} onClick={() => { setSoundOn(toggleSound()) }}>
                  <span class="nav-icon">{soundOn ? '\uD83D\uDD0A' : '\uD83D\uDD07'}</span>
                  <span class="nav-label">Sound</span>
                </button>
                {isFinished && <button class="bar-btn nav-btn eye-toggle" title={showSeqStones ? 'Hide sequence stones' : 'Show sequence stones'} onClick={() => setShowSeqStones(v => !v)}>
                  <span class="nav-icon">{showSeqStones ? '\uD83D\uDCAD' : '\uD83D\uDC41'}</span>
                  <span class="nav-label">{showSeqStones ? 'Hide' : 'Show'}</span>
                </button>}
                <button class="bar-btn nav-btn" title="Previous problem" onClick={onPrev}>
                  <span class="nav-icon">&#x25C2;</span>
                  <span class="nav-label">Prev</span>
                </button>
                <button class="bar-btn nav-btn" title="Back to library (Esc)" onClick={tryBack}>
                  <span class="nav-icon">&#x25B4;</span>
                  <span class="nav-label">Back</span>
                </button>
                <button class="bar-btn nav-btn" title="Next problem" onClick={onNext}>
                  <span class="nav-icon">&#x25B8;</span>
                  <span class="nav-label">Next</span>
                </button>
                {!isFinished && <button class="bar-btn nav-btn" title="Rewind to move 1 (R)" onClick={doRewind}>
                  <span class="nav-icon">&#x21BA;</span>
                  <span class="nav-label">Rewind</span>
                </button>}
                {isFinished && <button class="bar-btn nav-btn" title="Restart this problem (R)" onClick={doRestart}>
                  <span class="nav-icon">&#x21BB;</span>
                  <span class="nav-label">Restart</span>
                </button>}
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

function StatsBar({ sgfId }) {
  let scores = sgfId ? getScores(sgfId) : []
  let sorted = [...scores].sort((a, b) =>
    b.accuracy - a.accuracy || (a.totalMs || Infinity) - (b.totalMs || Infinity)
  )
  return (
    <div class="score-table-wrap">
      <table class="score-table">
        {sorted.map((s, i) => {
          let isLatest = s === scores[scores.length - 1]
          return (
            <tr key={i} class={isLatest ? 'score-latest' : ''}>
              <td class="score-rank">{i + 1}.</td>
              <td class={`score-frac${s.accuracy >= 1 ? ' score-perfect' : ''}`}>{scoreLabel(s)}</td>
              <td class="score-time">{s.totalMs ? (s.totalMs / 1000).toFixed(1) + 's' : ''}</td>
              <td class="score-date">{s.date ? formatDate(s.date) : ''}</td>
            </tr>
          )
        })}
      </table>
    </div>
  )
}
