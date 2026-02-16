import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { Goban } from '@sabaki/shudan'
import { QuizEngine } from './engine.js'
import { playCorrect, playWrong, playComplete, resetStreak } from './sounds.js'
import { kv, kvSet, kvRemove, getScores } from './db.js'

function saveHistory(quizKey, history) {
  kvSet('quizHistory', JSON.stringify({ key: quizKey, history }))
}

function makeEmptyMap(size, fill = null) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

export function Quiz({ sgf, sgfId, quizKey, onBack, onSolved, onProgress, onLoadError, onNextUnsolved }) {
  let engineRef = useRef(null)
  let historyRef = useRef([])
  let solvedRef = useRef(false)
  let [, forceRender] = useState(0)
  let rerender = () => forceRender(n => n + 1)
  let [vertexSize, setVertexSize] = useState(0)
  let boardRowRef = useRef(null)
  let [mode] = useState(() => kv('quizMode', 'liberty-end'))
  let [maxQ] = useState(() => parseInt(kv('quizMaxQ', '2')))
  let [error, setError] = useState(null)
  let questionStartRef = useRef(null)
  let timesRef = useRef([])
  let [wrongFlash, setWrongFlash] = useState(false)
  let [markedLiberties, setMarkedLiberties] = useState(new Set())
  let [reviewVertex, setReviewVertex] = useState(null)

  // Initialize engine fresh every time, advance first move
  if (!engineRef.current && !error) {
    resetStreak()
    try {
      engineRef.current = new QuizEngine(sgf, mode, true, maxQ)
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

  let advance = useCallback(() => {
    if (engine.finished || engine.questionVertex) return
    if (engine.showingMove) {
      engine.activateQuestions()
      if (!engine.questionVertex && !engine.finished) engine.advance()
    } else {
      engine.advance()
    }
    checkFinished()
    rerender()
  }, [])

  let submitMarks = useCallback(() => {
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

  let onVertexClick = useCallback((evt, vertex) => {
    if (engine.finished) return
    let key = `${vertex[0]},${vertex[1]}`
    // No question: tap = advance
    if (!engine.questionVertex) {
      advance()
      return
    }
    // Clicking the questioned group's vertex submits
    let qv = engine.questionVertex
    if (vertex[0] === qv[0] && vertex[1] === qv[1]) { submitMarks(); return }
    // Toggle liberty mark
    setMarkedLiberties(prev => {
      let next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [submitMarks, advance])

  // Review mode: hold to show liberties
  let onVertexPointerDown = useCallback((evt, vertex) => {
    if (!engine.finished) return
    setReviewVertex(`${vertex[0]},${vertex[1]}`)
  }, [])

  useEffect(() => {
    if (!engine.finished) return
    let up = () => setReviewVertex(null)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [engine.finished])

  let markSolved = useCallback(() => {
    onSolved(0, 0, null)
    onNextUnsolved()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    let preSolve = !engine.finished && engine.results.length === 0
    function onKeyDown(e) {
      if (e.key === 'Escape') { e.preventDefault(); onBack() }
      else if (e.key === 'Enter' && preSolve) { e.preventDefault(); markSolved() }
      else if (e.key === ' ') {
        e.preventDefault()
        if (engine.finished) onNextUnsolved()
        else if (engine.questionVertex) submitMarks()
        else advance()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [advance, submitMarks])

  // Start question timer / clear marks when a question appears
  useEffect(() => {
    if (!engine) return
    if (engine.questionVertex && questionStartRef.current === null) {
      questionStartRef.current = performance.now()
      setMarkedLiberties(new Set())
    }
    if (!engine.questionVertex) questionStartRef.current = null
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
      setVertexSize(Math.max(1, Math.floor(Math.min(width / (cols + 1), height / (rows + 1)))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [cols, rows])

  // Build display maps
  let size = engine.boardSize
  let signMap, markerMap, ghostStoneMap, paintMap

  if (engine.finished) {
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
      markerMap[y][x] = { type: 'label', label: '❓' }
      for (let key of markedLiberties) {
        let [mx, my] = key.split(',').map(Number)
        markerMap[my][mx] = { type: 'circle' }
      }
    }
  }

  let preSolve = !engine.finished && engine.results.length === 0

  return (
    <div class="quiz">
      <div class="board-row" ref={boardRowRef}>
        <div class={`board-container${wrongFlash ? ' wrong-flash' : ''}${engine.finished ? ' finished' : ''}`}>
          {vertexSize > 0 && <Goban
            vertexSize={vertexSize}
            signMap={signMap}
            markerMap={markerMap}
            ghostStoneMap={ghostStoneMap}
            paintMap={paintMap}
            onVertexClick={onVertexClick}
            onVertexPointerDown={onVertexPointerDown}
            rangeX={rangeX}
            rangeY={rangeY}
            showCoordinates={false}
            fuzzyStonePlacement={false}
            animateStonePlacement={false}
          />}
        </div>
        {!preSolve && <button class="back-overlay" title="Back to library (Esc)" onClick={onBack}>&#x25C2;</button>}
      </div>

      <div class="bottom-bar">
        {engine.finished
          ? <>
              <StatsBar engine={engine} times={timesRef.current} sgfId={sgfId} />
              <button class="bar-btn ctx-btn" onClick={onNextUnsolved}>Next</button>
            </>
          : preSolve
            ? <div class="bottom-bar-row">
                <button class="bar-btn" onClick={onBack}>&#x25C2; Back</button>
                <button class="bar-btn mark-solved-btn" onClick={markSolved}>Mark as solved</button>
              </div>
            : null
        }
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
