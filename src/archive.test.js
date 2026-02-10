import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import JSZip from 'jszip'
import { parseSgf, decodeSgf } from './sgf-utils.js'
import { QuizEngine } from './engine.js'

// Test the full pipeline: zip → extract → flatten → parse → engine
let zipPath = new URL('../SGFBooks.zip', import.meta.url).pathname
let zipBuf = readFileSync(zipPath)

// Inline extraction + flattening (mirrors archive.js logic for Node compat)
async function extractAndFlatten(buf) {
  let zip = await JSZip.loadAsync(buf)
  let entries = []
  for (let [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.toLowerCase().endsWith('.sgf')) continue
    entries.push({ name, content: decodeSgf(await entry.async('uint8array')) })
  }
  // flattenSingleRoot
  if (entries.length > 0) {
    let roots = new Set(entries.map(e => e.name.split('/')[0]))
    if (roots.size === 1) {
      let prefix = [...roots][0] + '/'
      if (entries.every(e => e.name.startsWith(prefix)))
        entries = entries.map(e => ({ ...e, name: e.name.slice(prefix.length) }))
    }
  }
  return entries
}

describe('SGFBooks.zip', () => {
  let entries

  it('extracts SGF entries and flattens single root', { timeout: 30000 }, async () => {
    entries = await extractAndFlatten(zipBuf)
    expect(entries.length).toBeGreaterThan(0)
    // Verify flattening: no single shared root remaining
    let roots = new Set(entries.map(e => e.name.split('/')[0]))
    console.log(`${entries.length} SGFs, ${roots.size} top-level dirs: ${[...roots].slice(0, 10).join(', ')}${roots.size > 10 ? '...' : ''}`)
    expect(roots.size).toBeGreaterThan(1)
  })

  it('all SGFs parse without error', { timeout: 30000 }, async () => {
    entries = entries || await extractAndFlatten(zipBuf)
    let failures = []
    for (let { name, content } of entries) {
      try {
        parseSgf(content)
      } catch (e) {
        failures.push({ name, error: e.message })
      }
    }
    if (failures.length > 0) {
      console.log(`Parse failures (${failures.length}):`)
      for (let f of failures) console.log(`  ${f.name}: ${f.error}`)
    }
    console.log(`Parsed ${entries.length - failures.length}/${entries.length}`)
    // Allow up to 0.1% parse failures from malformed SGFs in the archive
    expect(failures.length).toBeLessThan(entries.length * 0.001)
  })

  it('no consecutive same-color moves (encoding correctness)', { timeout: 30000 }, async () => {
    entries = entries || await extractAndFlatten(zipBuf)
    let suspicious = []
    for (let { name, content } of entries) {
      try {
        let { moves } = parseSgf(content)
        for (let i = 1; i < moves.length; i++) {
          if (moves[i].sign === moves[i - 1].sign) {
            suspicious.push({ name, moveIdx: i, sign: moves[i].sign })
            break
          }
        }
      } catch { /* parse failures handled by other test */ }
    }
    if (suspicious.length > 0) {
      console.log(`Consecutive same-color moves (${suspicious.length}):`)
      for (let s of suspicious) console.log(`  ${s.name}: move ${s.moveIdx} sign=${s.sign}`)
    }
    // Some SGFs may legitimately have consecutive same-color (e.g. handicap formats)
    // but encoding bugs cause many — allow a tiny fraction
    expect(suspicious.length).toBeLessThan(entries.length * 0.01)
  })

  it('all move coordinates are within board bounds', { timeout: 30000 }, async () => {
    entries = entries || await extractAndFlatten(zipBuf)
    let outOfBounds = []
    for (let { name, content } of entries) {
      try {
        let { moves, boardSize } = parseSgf(content)
        for (let i = 0; i < moves.length; i++) {
          let v = moves[i].vertex
          if (!v) continue // pass
          let [x, y] = v
          if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) {
            outOfBounds.push({ name, moveIdx: i, vertex: v, boardSize })
            break
          }
        }
      } catch {}
    }
    if (outOfBounds.length > 0) {
      console.log(`Out-of-bounds moves (${outOfBounds.length}):`)
      for (let o of outOfBounds) console.log(`  ${o.name}: move ${o.moveIdx} at [${o.vertex}] on ${o.boardSize}x${o.boardSize}`)
    }
    expect(outOfBounds.length).toBe(0)
  })

  it('sampled SGFs can init QuizEngine and advance', { timeout: 60000 }, async () => {
    entries = entries || await extractAndFlatten(zipBuf)
    // Sample 500 evenly spaced entries to keep test fast
    let step = Math.max(1, Math.floor(entries.length / 500))
    let sample = entries.filter((_, i) => i % step === 0)
    let failures = []
    let noMoves = 0
    let parseErrors = 0
    for (let { name, content } of sample) {
      try {
        let engine = new QuizEngine(content)
        if (engine.totalMoves === 0) { noMoves++; continue }
        engine.advance()
      } catch (e) {
        if (e.message.includes('Unexpected token')) { parseErrors++; continue }
        failures.push({ name, error: e.message })
      }
    }
    if (failures.length > 0) {
      console.log(`Engine failures (${failures.length}):`)
      for (let f of failures) console.log(`  ${f.name}: ${f.error}`)
    }
    console.log(`Engine OK: ${sample.length - failures.length - noMoves - parseErrors}/${sample.length} sampled (${noMoves} no moves, ${parseErrors} parse errors)`)
    expect(failures.length).toBe(0)
  })
})
