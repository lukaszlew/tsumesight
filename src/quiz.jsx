import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { BoundedGoban } from '@sabaki/shudan'
import { QuizEngine } from './engine.js'
import { playCorrect, playWrong, playComplete, isSoundEnabled, toggleSound } from './sounds.js'

function makeEmptyMap(size, fill = null) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

export function Quiz({ sgf, onBack, onSolved, onPrev, onNext, onNextUnsolved, onRetry, fileIndex, fileTotal }) {
  let engineRef = useRef(null)
  let [, forceRender] = useState(0)
  let rerender = () => forceRender(n => n + 1)
  let [peeking, setPeeking] = useState(false)
  let [error, setError] = useState(null)

  // Initialize engine once
  if (!engineRef.current && !error) {
    try {
      engineRef.current = new QuizEngine(sgf)
      engineRef.current.advance()
    } catch (e) {
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
          <button class="back-btn" onClick={onBack}>Back to Library</button>
        </div>
      </div>
    )
  }

  let solvedRef = useRef(false)

  let checkFinished = () => {
    if (engine.finished && !solvedRef.current) {
      solvedRef.current = true
      onSolved()
      playComplete()
    }
  }

  let submitAnswer = useCallback((liberties) => {
    if (!engine.questionVertex) return
    let result = engine.answer(liberties)
    if (result.correct) {
      playCorrect()
      if (result.done) engine.advance()
    } else {
      playWrong()
    }
    checkFinished()
    rerender()
  }, [])

  // Keyboard shortcuts + hold space to peek
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === ' ') { e.preventDefault(); setPeeking(true) }
      else if (e.key >= '1' && e.key <= '5') submitAnswer(parseInt(e.key))
    }
    function onKeyUp(e) {
      if (e.key === ' ') setPeeking(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [submitAnswer])

  // Build display maps
  let size = engine.boardSize
  let signMap = engine.finished ? engine.trueBoard.signMap : engine.getDisplaySignMap()
  let markerMap = makeEmptyMap(size)
  let ghostStoneMap = makeEmptyMap(size)

  // Current move: ghost stone (semi-transparent last move indicator)
  if (engine.currentMove) {
    let [x, y] = engine.currentMove.vertex
    ghostStoneMap[y][x] = { sign: engine.currentMove.sign, faint: true }
  }

  if (peeking) {
    // Show invisible stones as ghost stones + group scores as labels
    let groups = engine.peekGroupScores
    for (let group of groups) {
      for (let [x, y] of group.vertices) {
        let sign = engine.trueBoard.get([x, y])
        ghostStoneMap[y][x] = { sign, faint: true }
      }
      // Show score on first vertex of each group
      let [x, y] = group.vertices[0]
      markerMap[y][x] = { type: 'label', label: String(group.score) }
    }
  } else {
    // Show all pending question vertices
    if (engine.questionVertex) {
      let [x, y] = engine.questionVertex
      markerMap[y][x] = { type: 'label', label: '❓' }
    }
  }

  return (
    <div class="quiz">
      <TopBar
        moveIndex={engine.moveIndex}
        totalMoves={engine.totalMoves}
        questionIndex={engine.questionIndex}
        questionCount={engine.questions.length}
        onBack={onBack}
        onPrev={onPrev}
        onNext={onNext}
        fileIndex={fileIndex}
        fileTotal={fileTotal}
      />

      <div class="board-row">
        <div
          class="board-container"
          onPointerDown={() => setPeeking(true)}
          onPointerUp={() => setPeeking(false)}
          onPointerLeave={() => setPeeking(false)}
        >
          <BoundedGoban
            maxWidth={560}
            maxHeight={560}
            signMap={signMap}
            markerMap={markerMap}
            ghostStoneMap={ghostStoneMap}
            showCoordinates={false}
            fuzzyStonePlacement={false}
            animateStonePlacement={false}
          />
        </div>

        {peeking && !engine.finished && <ScoringRules />}
        {engine.finished && <SummaryPanel engine={engine} onBack={onBack} onRetry={onRetry} onNextUnsolved={onNextUnsolved} />}
      </div>

      {!engine.finished && <AnswerButtons onLiberties={submitAnswer} />}

      <FeedbackStrip results={engine.results} />
    </div>
  )
}

function TopBar({ moveIndex, totalMoves, questionIndex, questionCount, onBack, onPrev, onNext, fileIndex, fileTotal }) {
  let [soundOn, setSoundOn] = useState(isSoundEnabled())
  return (
    <div class="top-bar">
      <button class="back-btn small" onClick={onBack}>←</button>
      <div class="nav-group">
        <button class="back-btn small" onClick={onPrev}>◀</button>
        {fileTotal && <span class="file-counter">{fileIndex}/{fileTotal}</span>}
        <button class="back-btn small" onClick={onNext}>▶</button>
      </div>
      <span class="move-counter">
        Move {moveIndex} / {totalMoves}
        {questionCount > 1 && ` · Q ${questionIndex + 1}/${questionCount}`}
      </span>
      <button class="sound-toggle" onClick={() => setSoundOn(toggleSound())}>
        {soundOn ? '🔊' : '🔇'}
      </button>
    </div>
  )
}

function SummaryPanel({ engine, onBack, onRetry, onNextUnsolved }) {
  let total = engine.results.length
  let pct = total > 0 ? Math.round(engine.correct / total * 100) : 0
  return (
    <div class="summary-panel">
      <div class="scoring-title">Quiz Complete</div>
      <div>Moves: {total}</div>
      <div class="summary-correct">Correct: {engine.correct}</div>
      <div class="summary-wrong">Wrong: {engine.wrong}</div>
      <div>Accuracy: {pct}%</div>
      <hr />
      <button class="back-btn" onClick={onBack}>Back</button>
      <button class="back-btn" onClick={onRetry}>Retry</button>
      <button class="back-btn" onClick={onNextUnsolved}>Next Unsolved</button>
    </div>
  )
}

function ScoringRules() {
  return (
    <div class="scoring-rules">
      <div class="scoring-title">Group Score</div>
      <div>staleness + lib bonus</div>
      <hr />
      <div>+1/turn not asked</div>
      <div>(max +4)</div>
      <hr />
      <div>1-3 libs: +2</div>
      <div>4 libs: +1</div>
      <div>5+ libs: +0</div>
      <hr />
      <div>libs changed → priority</div>
    </div>
  )
}

function AnswerButtons({ onLiberties }) {
  let libertyValues = [1, 2, 3, 4, 5]

  return (
    <div class="answer-buttons">
      <div class="button-row">
        {libertyValues.map(l => (
          <button key={l} class="ans-btn" onClick={() => onLiberties(l)}>
            {l === 5 ? '5+' : l}
          </button>
        ))}
      </div>
    </div>
  )
}

function FeedbackStrip({ results }) {
  if (results.length === 0) return null

  // Split into completed streaks (ended by wrong) + ongoing streak
  let completed = []
  let current = 0
  for (let r of results) {
    if (r) current++
    else { if (current > 0) completed.push(current); current = 0 }
  }

  let pips = []
  let key = 0
  // Completed streaks: single numbered box each
  for (let count of completed) pips.push({ type: 'streak', count, key: key++ })
  // Ongoing streak: fold every 5 + individual ✓
  for (let f = 0; f < Math.floor(current / 5); f++) pips.push({ type: 'fat', key: key++ })
  for (let r = 0; r < current % 5; r++) pips.push({ type: 'correct', key: key++ })

  if (pips.length === 0) return null
  return (
    <div class="feedback-strip">
      {pips.map(p => (
        <span key={p.key} class={`pip pip-${p.type}`}>
          {p.type === 'streak' ? p.count : p.type === 'fat' ? '5' : '✓'}
        </span>
      ))}
    </div>
  )
}
