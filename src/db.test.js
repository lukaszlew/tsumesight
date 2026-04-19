// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { addReplay, getReplay, kvSet } from './db.js'

describe('addReplay / getReplay', () => {
  it('round-trips v:3 enriched payload', () => {
    let payload = {
      events: [
        { kind: 'advance', t: 0 },
        { kind: 'setMark', vertex: [4, 4], value: 3, t: 120 },
        { kind: 'submit', t: 400 },
      ],
      config: { maxSubmits: 2, maxQuestions: 2 },
      viewport: { w: 1024, h: 768, rotated: false },
      goldens: {
        scoreEntry: { correct: 1, total: 1, accuracy: 1, mistakes: 0 },
        finalMarks: [{ key: '4,4', value: 3, color: 'green' }],
        submitResults: [[{ status: 'correct', userVertex: '4,4', userVal: 3 }]],
        changedGroupsVertices: [[4, 4]],
      },
    }
    addReplay(111, 2000, payload)
    let record = getReplay(111, 2000)
    expect(record.v).toBe(3)
    expect(record.events).toEqual(payload.events)
    expect(record.config).toEqual(payload.config)
    expect(record.viewport).toEqual(payload.viewport)
    expect(record.goldens).toEqual(payload.goldens)
  })

  it('normalizes legacy v:2 records to v:3-shaped read', () => {
    // Write a v:2 blob directly via kvSet, then read through getReplay.
    let legacyEvents = [{ kind: 'advance', t: 0 }, { kind: 'submit', t: 100 }]
    kvSet('replay:222:3000', JSON.stringify({ v: 2, events: legacyEvents }))
    let record = getReplay(222, 3000)
    expect(record.v).toBe(3)
    expect(record.events).toEqual(legacyEvents)
    expect(record.config).toBeNull()
    expect(record.viewport).toBeNull()
    expect(record.goldens).toBeNull()
  })

  it('returns null for missing replay', () => {
    expect(getReplay(999, 9999)).toBeNull()
  })

  it('returns null for unknown version', () => {
    kvSet('replay:333:4000', JSON.stringify({ v: 99, events: [] }))
    expect(getReplay(333, 4000)).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    kvSet('replay:444:5000', 'not-json')
    expect(getReplay(444, 5000)).toBeNull()
  })
})
