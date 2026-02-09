import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { BoundedGoban } from '@sabaki/shudan'
import { QuizEngine } from './engine.js'
import { playCorrect, playWrong, isSoundEnabled, toggleSound } from './sounds.js'

function makeEmptyMap(size, fill = null) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

export function Quiz({ sgf, onBack }) {
  let engineRef = useRef(null)
  let [, forceRender] = useState(0)
  let rerender = () => forceRender(n => n + 1)
  let [peeking, setPeeking] = useState(false)

  // Initialize engine once
  if (!engineRef.current) {
    engineRef.current = new QuizEngine(sgf)
    engineRef.current.advance()
  }
  let engine = engineRef.current

  let submitAnswer = useCallback((liberties) => {
    let result = engine.answer(liberties)
    if (result.correct) playCorrect()
    else playWrong()
    engine.advance()
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

  // End of game summary
  if (engine.finished) {
    let total = engine.results.length
    let pct = total > 0 ? Math.round(engine.correct / total * 100) : 0
    return (
      <div class="quiz">
        <div class="summary-overlay">
          <h2>Quiz Complete</h2>
          <div class="summary-stats">
            <div>Total moves: {total}</div>
            <div class="summary-correct">Correct: {engine.correct}</div>
            <div class="summary-wrong">Wrong: {engine.wrong}</div>
            <div>Accuracy: {pct}%</div>
          </div>
          <button class="back-btn" onClick={onBack}>Back to Library</button>
        </div>
      </div>
    )
  }

  // Build display maps
  let size = engine.boardSize
  let signMap = engine.getDisplaySignMap()
  let markerMap = makeEmptyMap(size)
  let ghostStoneMap = makeEmptyMap(size)

  // Current move: circle marker (standard "last move" indicator)
  if (engine.currentMove) {
    let [x, y] = engine.currentMove.vertex
    markerMap[y][x] = { type: 'circle' }
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
    // Question vertex: ❓ marker
    if (engine.questionVertex) {
      let [x, y] = engine.questionVertex
      markerMap[y][x] = { type: 'label', label: '❓' }
    }
    // Last wrong answer: show correct liberty count on that stone
    if (engine.lastWrong) {
      let [x, y] = engine.lastWrong.vertex
      markerMap[y][x] = { type: 'label', label: '❶❷❸❹❺'[engine.lastWrong.trueLiberties - 1] }
    }
  }

  return (
    <div class="quiz">
      <TopBar
        moveIndex={engine.moveIndex}
        totalMoves={engine.totalMoves}
        onBack={onBack}
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

        {peeking && <ScoringRules />}
      </div>

      <AnswerButtons onLiberties={submitAnswer} />

      <FeedbackStrip results={engine.results} />
    </div>
  )
}

function TopBar({ moveIndex, totalMoves, onBack }) {
  let [soundOn, setSoundOn] = useState(isSoundEnabled())
  return (
    <div class="top-bar">
      <button class="back-btn small" onClick={onBack}>←</button>
      <span class="move-counter">Move {moveIndex} / {totalMoves}</span>
      <button class="sound-toggle" onClick={() => setSoundOn(toggleSound())}>
        {soundOn ? '🔊' : '🔇'}
      </button>
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

  // Fold runs of 5 consecutive corrects into fat pips
  let pips = []
  let i = 0
  while (i < results.length) {
    if (!results[i]) {
      pips.push({ type: 'wrong', key: i })
      i++
      continue
    }
    // Count consecutive corrects
    let run = 0
    while (i + run < results.length && results[i + run]) run++
    let fat = Math.floor(run / 5)
    let remainder = run % 5
    for (let f = 0; f < fat; f++) pips.push({ type: 'fat', key: i + f * 5 })
    for (let r = 0; r < remainder; r++) pips.push({ type: 'correct', key: i + fat * 5 + r })
    i += run
  }

  return (
    <div class="feedback-strip">
      {pips.map(p => (
        <span key={p.key} class={`pip pip-${p.type}`}>
          {p.type === 'wrong' ? '✗' : p.type === 'fat' ? '5' : '✓'}
        </span>
      ))}
    </div>
  )
}
