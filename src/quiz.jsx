import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { BoundedGoban } from '@sabaki/shudan'
import { QuizEngine } from './engine.js'

function makeEmptyMap(size, fill = null) {
  return Array.from({ length: size }, () => Array(size).fill(fill))
}

export function Quiz({ sgf, onBack }) {
  let engineRef = useRef(null)
  let [, forceRender] = useState(0)
  let rerender = () => forceRender(n => n + 1)

  // Initialize engine once
  if (!engineRef.current) {
    engineRef.current = new QuizEngine(sgf)
    engineRef.current.advance()
  }
  let engine = engineRef.current

  let [selectedColor, setSelectedColor] = useState(null)
  let [selectedLiberties, setSelectedLiberties] = useState(null)
  let [feedback, setFeedback] = useState(null) // {correct, trueColor, trueLiberties}

  let submitAnswer = useCallback((color, liberties) => {
    let result = engine.answer(color, liberties)
    setFeedback(result)

    // Brief delay to show feedback, then advance
    setTimeout(() => {
      setFeedback(null)
      setSelectedColor(null)
      setSelectedLiberties(null)
      engine.advance()
      rerender()
    }, result.correct ? 300 : 1200)
  }, [])

  // Auto-submit when both selections are made
  let selectColor = useCallback((c) => {
    if (feedback) return
    setSelectedColor(c)
    if (selectedLiberties != null) submitAnswer(c, selectedLiberties)
  }, [selectedLiberties, feedback, submitAnswer])

  let selectLiberties = useCallback((l) => {
    if (feedback) return
    setSelectedLiberties(l)
    if (selectedColor != null) submitAnswer(selectedColor, l)
  }, [selectedColor, feedback, submitAnswer])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (feedback) return
      if (e.key >= '1' && e.key <= '3') selectLiberties(parseInt(e.key))
      else if (e.key === '4') selectLiberties(4)
      else if (e.key === 'q') selectColor(1)
      else if (e.key === 'w') selectColor(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectColor, selectLiberties, feedback])

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
  let paintMap = makeEmptyMap(size, 0)

  // Current move: show move number label
  if (engine.currentMove) {
    let [x, y] = engine.currentMove.vertex
    markerMap[y][x] = { type: 'label', label: String(engine.moveIndex) }
  }

  // Question vertex: red dot marker
  if (engine.questionVertex) {
    let [x, y] = engine.questionVertex
    // Use paint for visibility if it's an empty intersection on display
    if (signMap[y][x] === 0) {
      markerMap[y][x] = { type: 'point' }
      paintMap[y][x] = 0.5
    } else {
      markerMap[y][x] = { type: 'point' }
    }
  }

  return (
    <div class="quiz">
      <TopBar
        moveIndex={engine.moveIndex}
        totalMoves={engine.totalMoves}
        correct={engine.correct}
        wrong={engine.wrong}
        onBack={onBack}
      />

      <div class="board-container">
        <BoundedGoban
          maxWidth={560}
          maxHeight={560}
          signMap={signMap}
          markerMap={markerMap}
          paintMap={paintMap}
          showCoordinates={false}
          fuzzyStonePlacement={true}
          animateStonePlacement={false}
        />
      </div>

      <AnswerButtons
        selectedColor={selectedColor}
        selectedLiberties={selectedLiberties}
        feedback={feedback}
        onColor={selectColor}
        onLiberties={selectLiberties}
      />

      <FeedbackStrip results={engine.results} />
    </div>
  )
}

function TopBar({ moveIndex, totalMoves, correct, wrong, onBack }) {
  return (
    <div class="top-bar">
      <button class="back-btn small" onClick={onBack}>←</button>
      <span class="move-counter">Move {moveIndex} / {totalMoves}</span>
      <span class="score">
        <span class="score-correct">✓ {correct}</span>
        {' '}
        <span class="score-wrong">✗ {wrong}</span>
      </span>
    </div>
  )
}

function AnswerButtons({ selectedColor, selectedLiberties, feedback, onColor, onLiberties }) {
  let libertyValues = [1, 2, 3, 4]
  let colorValues = [
    { sign: 1, label: '● Black', key: 'q' },
    { sign: -1, label: '○ White', key: 'w' },
  ]

  return (
    <div class="answer-buttons">
      <div class="button-row">
        {libertyValues.map(l => {
          let label = l === 4 ? '4+' : String(l)
          let cls = 'ans-btn'
          if (selectedLiberties === l) cls += ' selected'
          if (feedback && !feedback.correct && feedback.trueLiberties === l) cls += ' correct-hint'
          return (
            <button key={l} class={cls} onClick={() => onLiberties(l)} disabled={!!feedback}>
              {label}
            </button>
          )
        })}
      </div>
      <div class="button-row">
        {colorValues.map(({ sign, label }) => {
          let cls = 'ans-btn color-btn'
          if (selectedColor === sign) cls += ' selected'
          if (feedback && !feedback.correct && feedback.trueColor === sign) cls += ' correct-hint'
          return (
            <button key={sign} class={cls} onClick={() => onColor(sign)} disabled={!!feedback}>
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FeedbackStrip({ results }) {
  if (results.length === 0) return null
  return (
    <div class="feedback-strip">
      {results.map((r, i) => (
        <span key={i} class={`pip ${r ? 'pip-correct' : 'pip-wrong'}`}>
          {r ? '✓' : '✗'}
        </span>
      ))}
    </div>
  )
}
