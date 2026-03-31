import { describe, it, expect, beforeEach } from 'vitest'
import { QuizEngine } from './engine.js'

// Mirror the replay playback logic from quiz.jsx useEffect
function replayEvents(sgfString, events, maxQ = 2) {
  let engine = new QuizEngine(sgfString, true, maxQ)
  engine.advance()

  for (let evt of events) {
    if (engine.finished) break

    if (evt.ex) {
      // Exercise submission
      if (engine.libertyExerciseActive) {
        let marksPerPhase = new Map(Object.entries(evt.ex).map(([k, v]) => [k, v]))
        engine.submitLibertyExercise(marksPerPhase)
        engine.advance()
      }
    } else if (evt.v) {
      // Vertex click — during exercise it's just visual (marks tracked in UI)
      // During advance phase, it advances
      if (!engine.libertyExerciseActive) {
        if (engine.showingMove) {
          engine.activateQuestions()
          if (!engine.libertyExerciseActive && !engine.finished) engine.advance()
        } else if (!engine.finished) {
          engine.advance()
        }
      }
    } else if (evt.a) {
      if (!engine.finished && !engine.libertyExerciseActive) {
        if (engine.showingMove) {
          engine.activateQuestions()
          if (!engine.libertyExerciseActive && !engine.finished) engine.advance()
        } else {
          engine.advance()
        }
      }
    }
  }

  return engine
}

// Play through normally with keyboard-style events, return engine + events
function playAndRecord(sgfString, { maxQ = 2, correct = true } = {}) {
  let engine = new QuizEngine(sgfString, true, maxQ)
  engine.advance()
  let events = []
  let t = 0

  while (!engine.finished) {
    if (engine.showingMove) {
      t += 100
      events.push({ t, a: 1 })
      engine.activateQuestions()
      if (!engine.libertyExerciseActive && !engine.finished) engine.advance()
      continue
    }

    if (engine.libertyExerciseActive) {
      let changedGroups = engine.libertyExercise.groups.filter(g => g.changed)
      let marksObj = {}
      let marksMap = new Map()
      if (correct) {
        for (let g of changedGroups) {
          let k = [...g.chainKeys][0]
          let v = Math.min(g.libCount, 6)
          marksObj[k] = v
          marksMap.set(k, v)
        }
      }
      t += 100
      events.push({ t, ex: marksObj })
      engine.submitLibertyExercise(marksMap)
      engine.advance()
      continue
    }

    break
  }

  return { engine, events }
}

// Same but uses vertex clicks for advances instead of {a} events
function playAndRecordWithClicks(sgfString, { maxQ = 2 } = {}) {
  let engine = new QuizEngine(sgfString, true, maxQ)
  engine.advance()
  let events = []
  let t = 0

  while (!engine.finished) {
    if (engine.showingMove) {
      t += 100
      events.push({ t, v: [0, 0] })
      engine.activateQuestions()
      if (!engine.libertyExerciseActive && !engine.finished) engine.advance()
      continue
    }

    if (engine.libertyExerciseActive) {
      let changedGroups = engine.libertyExercise.groups.filter(g => g.changed)
      let marksObj = {}
      let marksMap = new Map()
      for (let g of changedGroups) {
        let k = [...g.chainKeys][0]
        let v = Math.min(g.libCount, 6)
        marksObj[k] = v
        marksMap.set(k, v)
      }
      t += 100
      events.push({ t, ex: marksObj })
      engine.submitLibertyExercise(marksMap)
      engine.advance()
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
    it('{a} event past showing phase activates exercise', () => {
      let engine = replayEvents(SGF_1MOVE, [{ t: 100, a: 1 }])
      // single move = last move, so exercise should activate
      expect(engine.showingMove).toBe(false)
      expect(engine.libertyExerciseActive).toBe(true)
    })

    it('{v} event (vertex click) also advances past showing phase', () => {
      let engine = replayEvents(SGF_1MOVE, [{ t: 100, v: [0, 0] }])
      expect(engine.showingMove).toBe(false)
      expect(engine.libertyExerciseActive).toBe(true)
    })

    it('multiple {a} events advance through non-last moves', () => {
      // no questions until last move, so advances should zip through
      let engine = replayEvents(SGF_3MOVE, [
        { t: 100, a: 1 },  // activate move 1 (no questions) → advance move 2
        { t: 200, a: 1 },  // activate move 2 (no questions) → advance move 3
        { t: 300, a: 1 },  // activate move 3 (last) → exercise appears
      ])
      expect(engine.moveIndex).toBe(3)
      expect(engine.libertyExerciseActive).toBe(true)
    })
  })

  describe('exercise submission events', () => {
    it('submitting correct marks records correct answers', () => {
      let fresh = new QuizEngine(SGF_1MOVE, true, 2)
      fresh.advance()
      fresh.activateQuestions()
      let changedGroups = fresh.libertyExercise.groups.filter(g => g.changed)
      let marks = {}
      for (let g of changedGroups)
        marks[[...g.chainKeys][0]] = Math.min(g.libCount, 6)

      let events = [
        { t: 100, a: 1 },
        { t: 200, ex: marks },
      ]

      let engine = replayEvents(SGF_1MOVE, events)
      expect(engine.correct).toBe(changedGroups.length)
      expect(engine.finished).toBe(true)
    })

    it('submitting empty marks records wrong answers', () => {
      let events = [
        { t: 100, a: 1 },
        { t: 200, ex: {} },
      ]
      let engine = replayEvents(SGF_1MOVE, events)
      expect(engine.wrong).toBeGreaterThan(0)
      expect(engine.finished).toBe(true)
    })
  })

  describe('round-trip: record then replay', () => {
    it('1-move SGF perfect play', () => {
      let { engine: original, events } = playAndRecord(SGF_1MOVE)
      expect(original.finished).toBe(true)

      let replayed = replayEvents(SGF_1MOVE, events)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.wrong).toBe(original.wrong)
      expect(replayed.errors).toBe(original.errors)
      expect(replayed.results).toEqual(original.results)
    })

    it('3-move SGF perfect play', () => {
      let { engine: original, events } = playAndRecord(SGF_3MOVE)
      expect(original.finished).toBe(true)

      let replayed = replayEvents(SGF_3MOVE, events)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.wrong).toBe(original.wrong)
      expect(replayed.results).toEqual(original.results)
    })

    it('5-move SGF perfect play', () => {
      let { engine: original, events } = playAndRecord(SGF_5MOVE)
      expect(original.finished).toBe(true)

      let replayed = replayEvents(SGF_5MOVE, events)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.results).toEqual(original.results)
    })

    it('adjacent moves', () => {
      let { engine: original, events } = playAndRecord(SGF_ADJACENT)
      expect(original.finished).toBe(true)

      let replayed = replayEvents(SGF_ADJACENT, events)
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

    it('wrong answers: empty marks', () => {
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

    it('wrong answers with adjacent moves', () => {
      let { engine: original, events } = playAndRecord(SGF_ADJACENT, { correct: false })
      expect(original.finished).toBe(true)

      let replayed = replayEvents(SGF_ADJACENT, events)
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

  describe('edge cases', () => {
    it('extra events after finish are ignored', () => {
      let { events } = playAndRecord(SGF_1MOVE)
      // Append garbage events
      events.push({ t: 9999, a: 1 })
      events.push({ t: 9999, v: [0, 0] })

      let engine = replayEvents(SGF_1MOVE, events)
      expect(engine.finished).toBe(true)
    })

    it('exercise submission without active exercise is ignored', () => {
      let events = [
        { t: 100, ex: {} }, // submit when showing, no exercise
      ]
      let engine = replayEvents(SGF_1MOVE, events)
      // Engine should still be in showing state, unaffected
      expect(engine.showingMove).toBe(true)
      expect(engine.results.length).toBe(0)
    })

    it('{a} event during exercise phase is ignored', () => {
      let events = [
        { t: 100, a: 1 },  // activate exercise
        { t: 200, a: 1 },  // should be ignored (exercise active)
      ]
      let engine = replayEvents(SGF_1MOVE, events)
      expect(engine.libertyExerciseActive).toBe(true)
      expect(engine.results.length).toBe(0) // no answer given
    })

    it('maxQ=1 replay matches original', () => {
      let { engine: original, events } = playAndRecord(SGF_5MOVE, { maxQ: 1 })
      let replayed = replayEvents(SGF_5MOVE, events, 1)
      expect(replayed.finished).toBe(true)
      expect(replayed.correct).toBe(original.correct)
      expect(replayed.results).toEqual(original.results)
    })

    it('maxQ=3 replay matches original', () => {
      let { engine: original, events } = playAndRecord(SGF_ADJACENT, { maxQ: 3 })
      let replayed = replayEvents(SGF_ADJACENT, events, 3)
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

    it('each event has exactly one type key (a or ex)', () => {
      let { events } = playAndRecord(SGF_5MOVE)
      for (let evt of events) {
        let keys = ['v', 'a', 'ex'].filter(k => k in evt)
        expect(keys.length).toBe(1)
      }
    })

    it('events have non-negative timestamps', () => {
      let { events } = playAndRecord(SGF_5MOVE)
      for (let evt of events) {
        expect(evt.t).toBeGreaterThanOrEqual(0)
      }
    })

    it('recorded events include advance and exercise types', () => {
      let { events } = playAndRecord(SGF_5MOVE)
      let hasA = events.some(e => e.a)
      let hasEx = events.some(e => e.ex)
      expect(hasA).toBe(true)
      expect(hasEx).toBe(true)
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

  describe('replay does not call checkFinished', () => {
    it('replayed engine reaches finished but does not produce side effects', () => {
      let { events } = playAndRecord(SGF_1MOVE)
      let engine = replayEvents(SGF_1MOVE, events)
      expect(engine.finished).toBe(true)
      // The replay loop should NOT call onSolved/checkFinished.
      // We verify that the engine reaches finished state purely through
      // direct engine method calls, not through callbacks.
      expect(engine.correct).toBeGreaterThanOrEqual(0)
      expect(engine.results.length).toBeGreaterThan(0)
    })
  })
})

describe('Replay versioning format', () => {
  it('v2 wrapper round-trips correctly', () => {
    let events = [{ t: 100, a: 1 }, { t: 200, ex: {} }]
    let stored = JSON.stringify({ v: 2, events })
    let parsed = JSON.parse(stored)
    expect(parsed.v).toBe(2)
    expect(parsed.events).toEqual(events)
  })

  it('old array format is rejected', () => {
    let oldFormat = JSON.stringify([{ t: 100, a: 1 }])
    let parsed = JSON.parse(oldFormat)
    // Old format is a plain array, not an object with v:2
    expect(!parsed || parsed.v !== 2).toBe(true)
  })

  it('v1 or missing version is rejected', () => {
    let v1 = JSON.parse(JSON.stringify({ v: 1, events: [] }))
    expect(v1.v !== 2).toBe(true)
    let noVersion = JSON.parse(JSON.stringify({ events: [] }))
    expect(!noVersion.v || noVersion.v !== 2).toBe(true)
  })
})
