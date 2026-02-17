import { describe, it, expect } from 'vitest'
import { QuizEngine } from './engine.js'

// Mirror the replay playback logic from quiz.jsx useEffect
function replayEvents(sgfString, events, mode = 'liberty-end', maxQ = 2) {
  let engine = new QuizEngine(sgfString, mode, true, maxQ)
  engine.advance()
  let marks = new Set()

  for (let evt of events) {
    if (engine.finished) break

    if (evt.cmp) {
      if (engine.comparisonPair) {
        let result = engine.answerComparison(evt.cmp)
        if (result.done && !engine.finished) engine.advance()
      }
    } else if (evt.v) {
      if (engine.comparisonPair) {
        let pair = engine.comparisonPair
        let key = `${evt.v[0]},${evt.v[1]}`
        let zKey = `${pair.vertexZ[0]},${pair.vertexZ[1]}`
        let xKey = `${pair.vertexX[0]},${pair.vertexX[1]}`
        if (key === zKey) {
          let result = engine.answerComparison('Z')
          if (result.done && !engine.finished) engine.advance()
        } else if (key === xKey) {
          let result = engine.answerComparison('X')
          if (result.done && !engine.finished) engine.advance()
        }
      } else if (!engine.questionVertex) {
        if (engine.showingMove) {
          engine.activateQuestions()
          if (!engine.questionVertex && !engine.comparisonPair && !engine.finished) engine.advance()
        } else if (!engine.finished) {
          engine.advance()
        }
      } else {
        let key = `${evt.v[0]},${evt.v[1]}`
        if (marks.has(key)) marks.delete(key)
        else marks.add(key)
      }
    } else if (evt.a) {
      if (!engine.finished && !engine.questionVertex && !engine.comparisonPair) {
        if (engine.showingMove) {
          engine.activateQuestions()
          if (!engine.questionVertex && !engine.comparisonPair && !engine.finished) engine.advance()
        } else {
          engine.advance()
        }
      }
    } else if (evt.s) {
      if (engine.questionVertex) {
        let result = engine.answerMark(marks)
        marks = new Set()
        if (result.done && !engine.finished) engine.advance()
      }
    }
  }

  return engine
}

// Play through normally with keyboard-style events, return engine + events
function playAndRecord(sgfString, { mode = 'liberty-end', maxQ = 2, correct = true } = {}) {
  let engine = new QuizEngine(sgfString, mode, true, maxQ)
  engine.advance()
  let events = []
  let t = 0

  while (!engine.finished) {
    if (engine.showingMove) {
      t += 100
      events.push({ t, a: 1 })
      engine.activateQuestions()
      if (!engine.questionVertex && !engine.comparisonPair && !engine.finished) engine.advance()
      continue
    }

    if (engine.questionVertex) {
      if (correct) {
        let libs = engine.trueBoard.getLiberties(engine.questionVertex)
        for (let [x, y] of libs) {
          t += 50
          events.push({ t, v: [x, y] })
        }
      }
      t += 100
      events.push({ t, s: 1 })
      let markedSet = correct
        ? new Set(engine.trueBoard.getLiberties(engine.questionVertex).map(([x, y]) => `${x},${y}`))
        : new Set()
      let result = engine.answerMark(markedSet)
      if (result.done && !engine.finished) engine.advance()
      continue
    }

    if (engine.comparisonPair) {
      let { libsZ, libsX } = engine.comparisonPair
      let trueAnswer = libsZ > libsX ? 'Z' : libsX > libsZ ? 'X' : 'equal'
      let answer = correct ? trueAnswer : (trueAnswer === 'Z' ? 'X' : 'Z')
      t += 100
      events.push({ t, cmp: answer })
      let result = engine.answerComparison(answer)
      if (result.done && !engine.finished) engine.advance()
      continue
    }

    break
  }

  return { engine, events }
}

// Same but uses vertex clicks for advances instead of {a} events
function playAndRecordWithClicks(sgfString, { mode = 'liberty-end', maxQ = 2 } = {}) {
  let engine = new QuizEngine(sgfString, mode, true, maxQ)
  engine.advance()
  let events = []
  let t = 0

  while (!engine.finished) {
    if (engine.showingMove) {
      t += 100
      events.push({ t, v: [0, 0] })
      engine.activateQuestions()
      if (!engine.questionVertex && !engine.comparisonPair && !engine.finished) engine.advance()
      continue
    }

    if (engine.questionVertex) {
      let libs = engine.trueBoard.getLiberties(engine.questionVertex)
      for (let [x, y] of libs) {
        t += 50
        events.push({ t, v: [x, y] })
      }
      t += 100
      events.push({ t, s: 1 })
      let markedSet = new Set(libs.map(([x, y]) => `${x},${y}`))
      let result = engine.answerMark(markedSet)
      if (result.done && !engine.finished) engine.advance()
      continue
    }

    if (engine.comparisonPair) {
      let { libsZ, libsX } = engine.comparisonPair
      let trueAnswer = libsZ > libsX ? 'Z' : libsX > libsZ ? 'X' : 'equal'
      t += 100
      // Click the Z or X stone vertex, or use cmp event for equal
      if (trueAnswer === 'equal') {
        events.push({ t, cmp: 'equal' })
      } else {
        let v = trueAnswer === 'Z' ? engine.comparisonPair.vertexZ : engine.comparisonPair.vertexX
        events.push({ t, v: [v[0], v[1]] })
      }
      let result = engine.answerComparison(trueAnswer)
      if (result.done && !engine.finished) engine.advance()
      continue
    }

    break
  }

  return { engine, events }
}

// Test SGFs
let SGF_1MOVE = '(;SZ[9];B[ee])'
let SGF_3MOVE = '(;SZ[5];B[bb];W[cc];B[dd])'
let SGF_5MOVE = '(;SZ[5];B[bb];W[cc];B[dd];W[ee];B[bc])'
let SGF_ADJACENT = '(;SZ[9];B[ee];W[de])'
let SGF_SETUP = '(;SZ[9]AB[dd][ed]AW[de][ee];B[cd];W[ce])'
let SGF_CAPTURE = '(;SZ[9];B[aa];W[ba];B[ee];W[ab])'

describe('Replay playback logic', () => {

  describe('empty events', () => {
    it('produces engine in initial state (first move advanced, showing)', () => {
      let engine = replayEvents(SGF_1MOVE, [])
      expect(engine.moveIndex).toBe(1)
      expect(engine.showingMove).toBe(true)
      expect(engine.finished).toBe(false)
    })

    it('no results recorded', () => {
      let engine = replayEvents(SGF_3MOVE, [])
      expect(engine.results.length).toBe(0)
      expect(engine.correct).toBe(0)
    })
  })

  describe('advance events', () => {
    it('{a} event past showing phase activates questions', () => {
      let engine = replayEvents(SGF_1MOVE, [{ t: 100, a: 1 }])
      // liberty-end mode, single move = last move, so questions should activate
      expect(engine.showingMove).toBe(false)
      expect(engine.questionVertex).not.toBe(null)
    })

    it('{v} event (vertex click) also advances past showing phase', () => {
      let engine = replayEvents(SGF_1MOVE, [{ t: 100, v: [0, 0] }])
      expect(engine.showingMove).toBe(false)
      expect(engine.questionVertex).not.toBe(null)
    })

    it('multiple {a} events advance through non-last moves in liberty-end mode', () => {
      // liberty-end: no questions until last move, so advances should zip through
      let engine = replayEvents(SGF_3MOVE, [
        { t: 100, a: 1 },  // activate move 1 (no questions) → advance move 2
        { t: 200, a: 1 },  // activate move 2 (no questions) → advance move 3
        { t: 300, a: 1 },  // activate move 3 (last) → questions appear
      ])
      expect(engine.moveIndex).toBe(3)
      expect(engine.questionVertex).not.toBe(null)
    })
  })

  describe('mark and submit events', () => {
    it('marking liberties and submitting records correct answer', () => {
      // Advance to question, mark correct liberties, submit
      let fresh = new QuizEngine(SGF_1MOVE, 'liberty-end', true, 2)
      fresh.advance()
      fresh.activateQuestions()
      let libs = fresh.trueBoard.getLiberties(fresh.questionVertex)

      let events = [{ t: 100, a: 1 }] // activate questions
      for (let i = 0; i < libs.length; i++) {
        events.push({ t: 200 + i * 50, v: libs[i] })
      }
      events.push({ t: 500, s: 1 })

      let engine = replayEvents(SGF_1MOVE, events)
      expect(engine.correct).toBe(1)
      expect(engine.results[0]).toBe(true)
    })

    it('submitting with no marks records wrong answer', () => {
      let events = [
        { t: 100, a: 1 }, // activate questions
        { t: 200, s: 1 }, // submit empty
      ]
      let engine = replayEvents(SGF_1MOVE, events)
      expect(engine.correct).toBe(0)
      expect(engine.wrong).toBe(1)
      expect(engine.results[0]).toBe(false)
    })

    it('toggling a mark on then off excludes it from submission', () => {
      let fresh = new QuizEngine(SGF_1MOVE, 'liberty-end', true, 2)
      fresh.advance()
      fresh.activateQuestions()
      let libs = fresh.trueBoard.getLiberties(fresh.questionVertex)
      let firstLib = libs[0]

      let events = [
        { t: 100, a: 1 },          // activate
        { t: 200, v: firstLib },    // mark
        { t: 300, v: firstLib },    // unmark (toggle off)
        { t: 400, s: 1 },          // submit with nothing marked
      ]
      let engine = replayEvents(SGF_1MOVE, events)
      // Submitted empty set → all liberties missed
      expect(engine.errors).toBe(libs.length)
    })

    it('toggling mark on-off-on includes it in submission', () => {
      let fresh = new QuizEngine(SGF_1MOVE, 'liberty-end', true, 2)
      fresh.advance()
      fresh.activateQuestions()
      let libs = fresh.trueBoard.getLiberties(fresh.questionVertex)

      let events = [{ t: 100, a: 1 }]
      // Mark all, unmark first, re-mark first
      let t = 200
      for (let lib of libs) { events.push({ t: t++, v: lib }) }
      events.push({ t: t++, v: libs[0] }) // unmark
      events.push({ t: t++, v: libs[0] }) // re-mark
      events.push({ t: t++, s: 1 })

      let engine = replayEvents(SGF_1MOVE, events)
      expect(engine.correct).toBe(1)
      expect(engine.errors).toBe(0)
    })
  })

  describe('round-trip: record then replay', () => {
    it('1-move SGF perfect play in liberty-end mode', () => {
      let { engine: original, events } = playAndRecord(SGF_1MOVE)
      expect(original.finished).toBe(true)

      let replayed = replayEvents(SGF_1MOVE, events)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.wrong).toBe(original.wrong)
      expect(replayed.errors).toBe(original.errors)
      expect(replayed.results).toEqual(original.results)
    })

    it('3-move SGF perfect play in liberty-end mode', () => {
      let { engine: original, events } = playAndRecord(SGF_3MOVE)
      expect(original.finished).toBe(true)

      let replayed = replayEvents(SGF_3MOVE, events)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.wrong).toBe(original.wrong)
      expect(replayed.results).toEqual(original.results)
    })

    it('5-move SGF perfect play in liberty-end mode', () => {
      let { engine: original, events } = playAndRecord(SGF_5MOVE)
      expect(original.finished).toBe(true)

      let replayed = replayEvents(SGF_5MOVE, events)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.results).toEqual(original.results)
    })

    it('adjacent moves in liberty mode', () => {
      let { engine: original, events } = playAndRecord(SGF_ADJACENT, { mode: 'liberty' })
      expect(original.finished).toBe(true)

      let replayed = replayEvents(SGF_ADJACENT, events, 'liberty')
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.wrong).toBe(original.wrong)
      expect(replayed.errors).toBe(original.errors)
      expect(replayed.results).toEqual(original.results)
    })

    it('SGF with setup stones', () => {
      let { engine: original, events } = playAndRecord(SGF_SETUP)
      expect(original.finished).toBe(true)

      let replayed = replayEvents(SGF_SETUP, events)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.results).toEqual(original.results)
    })

    it('SGF with capture', () => {
      let { engine: original, events } = playAndRecord(SGF_CAPTURE)
      expect(original.finished).toBe(true)

      let replayed = replayEvents(SGF_CAPTURE, events)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.results).toEqual(original.results)
    })

    it('wrong answers: empty marks on all questions', () => {
      let { engine: original, events } = playAndRecord(SGF_5MOVE, { correct: false })
      expect(original.finished).toBe(true)
      expect(original.wrong).toBeGreaterThan(0)

      let replayed = replayEvents(SGF_5MOVE, events)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.wrong).toBe(original.wrong)
      expect(replayed.errors).toBe(original.errors)
      expect(replayed.results).toEqual(original.results)
    })

    it('wrong answers in liberty mode', () => {
      let { engine: original, events } = playAndRecord(SGF_ADJACENT, { mode: 'liberty', correct: false })
      expect(original.finished).toBe(true)

      let replayed = replayEvents(SGF_ADJACENT, events, 'liberty')
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.wrong).toBe(original.wrong)
      expect(replayed.errors).toBe(original.errors)
    })
  })

  describe('vertex click advances', () => {
    it('clicking board vertex advances same as keyboard', () => {
      let { engine: withKeys, events: keyEvents } = playAndRecord(SGF_5MOVE)
      let { engine: withClicks, events: clickEvents } = playAndRecordWithClicks(SGF_5MOVE)

      // Both should finish
      expect(withKeys.finished).toBe(true)
      expect(withClicks.finished).toBe(true)

      // Same results
      expect(withClicks.correct).toBe(withKeys.correct)
      expect(withClicks.wrong).toBe(withKeys.wrong)
      expect(withClicks.results).toEqual(withKeys.results)

      // Click events replay correctly
      let replayed = replayEvents(SGF_5MOVE, clickEvents)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(withKeys.correct)
      expect(replayed.results).toEqual(withKeys.results)
    })

    it('vertex click round-trip with setup stones', () => {
      let { engine: original, events } = playAndRecordWithClicks(SGF_SETUP)
      let replayed = replayEvents(SGF_SETUP, events)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.results).toEqual(original.results)
    })
  })

  describe('mixed event types', () => {
    it('mixing {a} and {v} advances produces valid replay', () => {
      // Manually build events: some advances with {a}, some with {v}
      let fresh = new QuizEngine(SGF_3MOVE, 'liberty-end', true, 2)
      fresh.advance()

      let events = [
        { t: 100, v: [0, 0] },  // vertex click advance (move 1 → move 2)
        { t: 200, a: 1 },       // keyboard advance (move 2 → move 3, last)
        { t: 300, a: 1 },       // activate questions on last move
      ]

      // Continue: advance through moves
      fresh.activateQuestions() // move 1, no questions in liberty-end
      if (!fresh.questionVertex && !fresh.finished) fresh.advance()
      fresh.activateQuestions()
      if (!fresh.questionVertex && !fresh.finished) fresh.advance()
      fresh.activateQuestions()

      // Now add mark + submit for each question
      let eng = replayEvents(SGF_3MOVE, events)
      // Should be at question phase
      if (eng.questionVertex) {
        let libs = eng.trueBoard.getLiberties(eng.questionVertex)
        for (let [x, y] of libs) events.push({ t: events.length * 50 + 400, v: [x, y] })
        events.push({ t: events.length * 50 + 500, s: 1 })
      }

      // Replay full events
      let replayed = replayEvents(SGF_3MOVE, events)
      expect(replayed.results.length).toBeGreaterThan(0)
    })
  })

  describe('edge cases', () => {
    it('extra events after finish are ignored', () => {
      let { events } = playAndRecord(SGF_1MOVE)
      // Append garbage events
      events.push({ t: 9999, a: 1 })
      events.push({ t: 9999, v: [0, 0] })
      events.push({ t: 9999, s: 1 })

      let engine = replayEvents(SGF_1MOVE, events)
      expect(engine.finished).toBe(true)
    })

    it('submit without active question is ignored', () => {
      let events = [
        { t: 100, s: 1 }, // submit when showing, no question
      ]
      let engine = replayEvents(SGF_1MOVE, events)
      // Engine should still be in showing state, unaffected
      expect(engine.showingMove).toBe(true)
      expect(engine.results.length).toBe(0)
    })

    it('{a} event during question phase is ignored', () => {
      let events = [
        { t: 100, a: 1 },  // activate questions
        { t: 200, a: 1 },  // should be ignored (question active)
      ]
      let engine = replayEvents(SGF_1MOVE, events)
      expect(engine.questionVertex).not.toBe(null)
      expect(engine.results.length).toBe(0) // no answer given
    })

    it('maxQ=1 replay matches original', () => {
      let { engine: original, events } = playAndRecord(SGF_5MOVE, { maxQ: 1 })
      let replayed = replayEvents(SGF_5MOVE, events, 'liberty-end', 1)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.results).toEqual(original.results)
    })

    it('maxQ=3 replay matches original', () => {
      let { engine: original, events } = playAndRecord(SGF_ADJACENT, { mode: 'liberty', maxQ: 3 })
      let replayed = replayEvents(SGF_ADJACENT, events, 'liberty', 3)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.results).toEqual(original.results)
    })
  })

  describe('event format', () => {
    it('recorded events have monotonically increasing timestamps', () => {
      let { events } = playAndRecord(SGF_5MOVE)
      for (let i = 1; i < events.length; i++) {
        expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t)
      }
    })

    it('each event has exactly one type key (v, a, or s)', () => {
      let { events } = playAndRecord(SGF_5MOVE)
      for (let evt of events) {
        let keys = ['v', 'a', 's'].filter(k => k in evt)
        expect(keys.length).toBe(1)
      }
    })

    it('vertex events have 2-element arrays', () => {
      let { events } = playAndRecord(SGF_5MOVE)
      for (let evt of events) {
        if (evt.v) {
          expect(Array.isArray(evt.v)).toBe(true)
          expect(evt.v.length).toBe(2)
          expect(typeof evt.v[0]).toBe('number')
          expect(typeof evt.v[1]).toBe('number')
        }
      }
    })

    it('events have non-negative timestamps', () => {
      let { events } = playAndRecord(SGF_5MOVE)
      for (let evt of events) {
        expect(evt.t).toBeGreaterThanOrEqual(0)
      }
    })

    it('recorded events include all three types for a full game', () => {
      let { events } = playAndRecord(SGF_5MOVE)
      let hasA = events.some(e => e.a)
      let hasV = events.some(e => e.v)
      let hasS = events.some(e => e.s)
      expect(hasA).toBe(true)
      expect(hasV).toBe(true)
      expect(hasS).toBe(true)
    })
  })

  describe('board state after replay matches original', () => {
    it('trueBoard signMaps are identical', () => {
      let { engine: original, events } = playAndRecord(SGF_5MOVE)
      let replayed = replayEvents(SGF_5MOVE, events)
      expect(replayed.trueBoard.signMap).toEqual(original.trueBoard.signMap)
    })

    it('moveIndex matches', () => {
      let { engine: original, events } = playAndRecord(SGF_5MOVE)
      let replayed = replayEvents(SGF_5MOVE, events)
      expect(replayed.moveIndex).toBe(original.moveIndex)
    })

    it('questionsAsked structure matches', () => {
      let { engine: original, events } = playAndRecord(SGF_5MOVE)
      let replayed = replayEvents(SGF_5MOVE, events)
      expect(replayed.questionsAsked.length).toBe(original.questionsAsked.length)
      for (let i = 0; i < original.questionsAsked.length; i++) {
        expect(replayed.questionsAsked[i].length).toBe(original.questionsAsked[i].length)
        for (let j = 0; j < original.questionsAsked[i].length; j++) {
          expect(replayed.questionsAsked[i][j].vertex).toEqual(original.questionsAsked[i][j].vertex)
        }
      }
    })

    it('trueBoard matches after capture SGF', () => {
      let { engine: original, events } = playAndRecord(SGF_CAPTURE)
      let replayed = replayEvents(SGF_CAPTURE, events)
      expect(replayed.trueBoard.signMap).toEqual(original.trueBoard.signMap)
      // Captured stone at 0,0 should be empty
      expect(replayed.trueBoard.get([0, 0])).toBe(0)
    })

    it('marks are stored in questionsAsked after replay', () => {
      let { engine: original, events } = playAndRecord(SGF_1MOVE)
      let replayed = replayEvents(SGF_1MOVE, events)
      let origQ = original.questionsAsked.flat().filter(q => q.marks)
      let replayQ = replayed.questionsAsked.flat().filter(q => q.marks)
      expect(replayQ.length).toBe(origQ.length)
      for (let i = 0; i < origQ.length; i++) {
        expect(new Set(replayQ[i].marks)).toEqual(new Set(origQ[i].marks))
        expect(new Set(replayQ[i].trueLibs)).toEqual(new Set(origQ[i].trueLibs))
      }
    })
  })

  describe('partial replay', () => {
    it('stopping after first advance leaves engine mid-game', () => {
      let { events } = playAndRecord(SGF_5MOVE)
      // Only replay the first event
      let engine = replayEvents(SGF_5MOVE, events.slice(0, 1))
      expect(engine.finished).toBe(false)
      expect(engine.moveIndex).toBeLessThanOrEqual(3)
    })

    it('replaying half the events produces partial progress', () => {
      let { engine: original, events } = playAndRecord(SGF_5MOVE)
      let half = Math.floor(events.length / 2)
      let engine = replayEvents(SGF_5MOVE, events.slice(0, half))
      expect(engine.results.length).toBeLessThanOrEqual(original.results.length)
      expect(engine.moveIndex).toBeLessThanOrEqual(original.moveIndex)
    })
  })
})
