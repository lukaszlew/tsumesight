import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks'
import { init, step, phase, isLockedVertex } from './session.js'
import { derive } from './derive.js'
import { buildMaps, rotateMaps } from './display.js'
import { pickBoardLayout, QuizBoard } from './quiz-board.jsx'
import { RadialMenu, useWheel } from './quiz-wheel.jsx'
import { playCorrect, playWrong, playComplete, playStoneClick, playMark, resetStreak, isSoundEnabled, toggleSound } from './sounds.js'
import { kv, kvSet, getScores, addReplay, getLatestReplay } from './db.js'
import config from './config.js'
import { StarsDisplay } from './scoring.js'
import { sideEffectsFor, computeFinalizeData } from './effects.js'

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
  let view = useMemo(() => state ? derive(state) : null, [state])

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

  // Run a single effect descriptor from sideEffectsFor. Closure over
  // setWrongFlash + onProgress captures the UI-level targets.
  function runEffect(e) {
    switch (e.kind) {
      case 'sound/stoneClick': playStoneClick(); break
      case 'sound/mark': playMark(e.value); break
      case 'sound/correct': playCorrect(); break
      case 'sound/wrong': playWrong(); break
      case 'wrongFlash':
        setWrongFlash(true)
        setTimeout(() => setWrongFlash(false), 150)
        break
      case 'onProgress':
        onProgress({ correct: e.correct, done: e.done, total: e.total })
        break
    }
  }

  // Per-event side effects. Processes exactly the newest event since the
  // last render. On a review-mode mount (autoSolved) no event is new, so
  // nothing fires. dispatchAdvance still plays the stone-click sound
  // predictively — advance events' effects run here too, so don't double up.
  useEffect(() => {
    if (!state) return
    let lastIdx = state.events.length - 1
    if (lastIdx <= lastEventIdxRef.current) return
    lastEventIdxRef.current = lastIdx
    let evt = state.events[lastIdx]
    // Skip advance events — dispatchAdvance handles their sound predictively
    // (and this effect runs after React commits, potentially delayed).
    if (evt.kind === 'advance') return
    for (let e of sideEffectsFor(state, evt)) runEffect(e)
  }, [state])

  // Finalize effect: computeFinalizeData folds the scoring math; the
  // runner fans out into addReplay / onSolved / setFinishPopup /
  // playComplete. Gated by solvedRef so it fires exactly once per
  // session.
  useEffect(() => {
    if (!state) return
    if (phase(state) !== 'finished' || solvedRef.current) return
    solvedRef.current = true
    let ctx = {
      sgfId,
      config: sessionConfig,
      loadTimeMs: loadTimeRef.current,
      rotated,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    }
    let data = computeFinalizeData(state, ctx)
    playComplete(data.stars)
    addReplay(sgfId, data.date, data.replayPayload)
    onSolved(data.correct, data.total, data.scoreEntry)
    setFinishPopup(data.popupData)
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

  let isLocked = useCallback(v => isLockedVertex(state, v), [state])
  let { wheel, wheelUsedRef, onPointerDown: onVertexPointerDown, onPointerUp: onVertexPointerUp } = useWheel({
    enabled: inExercise,
    isLocked,
    commitMark,
    vertexSize,
    boardRowRef,
  })

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

  // Build display maps from the derived view. buildMaps + rotateMaps are
  // pure; callers test them in isolation.
  let maps = buildMaps(view, state, { isFinished, showSeqStones })
  let displayRangeX = rangeX, displayRangeY = rangeY
  if (rotated) {
    maps = rotateMaps(maps)
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
        <QuizBoard
          maps={maps}
          vertexSize={vertexSize}
          rangeX={displayRangeX}
          rangeY={displayRangeY}
          wrongFlash={wrongFlash}
          isFinished={isFinished}
          feedbackClass={feedbackClass}
          showingMoveClass={showingMoveClass}
          onVertexClick={handleVertexClick}
          onVertexPointerDown={handlePointerDown}
          onVertexPointerUp={handlePointerUp}
        />
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
