import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import JSZip from 'jszip'
import { parseSgf, decodeSgf } from './sgf-utils.js'
import { QuizEngine } from './engine.js'

// Test the full pipeline: zip → extract → flatten → parse → engine
let zipPath = new URL('../SGFBooks.zip', import.meta.url).pathname
let hasZip = existsSync(zipPath)
let zipBuf = hasZip ? readFileSync(zipPath) : null

// Extract raw bytes + decoded content for each SGF
async function extractRaw(buf) {
  let zip = await JSZip.loadAsync(buf)
  let entries = []
  for (let [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.toLowerCase().endsWith('.sgf')) continue
    let bytes = await entry.async('uint8array')
    entries.push({ name, bytes, content: decodeSgf(bytes) })
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

describe.skipIf(!hasZip)('SGFBooks.zip', () => {
  let entries

  it('extracts SGF entries and flattens single root', { timeout: 30000 }, async () => {
    entries = await extractRaw(zipBuf)
    expect(entries.length).toBeGreaterThan(0)
    let roots = new Set(entries.map(e => e.name.split('/')[0]))
    console.log(`${entries.length} SGFs, ${roots.size} top-level dirs: ${[...roots].slice(0, 10).join(', ')}${roots.size > 10 ? '...' : ''}`)
    expect(roots.size).toBeGreaterThan(1)
  })

  it('all SGFs parse without error', { timeout: 30000 }, async () => {
    entries = entries || await extractRaw(zipBuf)
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
    expect(failures.length).toBeLessThan(entries.length * 0.001)
  })

  it('no consecutive same-color moves (encoding correctness)', { timeout: 30000 }, async () => {
    entries = entries || await extractRaw(zipBuf)
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
      } catch {}
    }
    if (suspicious.length > 0) {
      console.log(`Consecutive same-color moves (${suspicious.length}):`)
      for (let s of suspicious) console.log(`  ${s.name}: move ${s.moveIdx} sign=${s.sign}`)
    }
    expect(suspicious.length).toBeLessThan(entries.length * 0.01)
  })

  it('all move coordinates are within board bounds', { timeout: 30000 }, async () => {
    entries = entries || await extractRaw(zipBuf)
    let outOfBounds = []
    for (let { name, content } of entries) {
      try {
        let { moves, boardSize } = parseSgf(content)
        for (let i = 0; i < moves.length; i++) {
          let v = moves[i].vertex
          if (!v) continue
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

  // Detect files without CA that contain non-UTF-8 bytes — these could silently
  // lose moves if a multi-byte char contains 0x5D (']') or 0x5B ('[')
  it('no silent encoding failures in files without CA', { timeout: 60000 }, async () => {
    entries = entries || await extractRaw(zipBuf)
    let ENCODINGS = ['gbk', 'big5', 'euc-kr', 'shift_jis']
    let silentFailures = []

    for (let { name, bytes, content } of entries) {
      // Skip files that have CA property (already handled correctly)
      if (/CA\[/i.test(content.slice(0, 500))) continue
      // Skip pure ASCII / valid UTF-8 (no replacement chars)
      if (!content.includes('\uFFFD')) continue

      // This file has non-UTF-8 bytes and no CA — try other encodings
      let utf8Moves = null
      try { utf8Moves = parseSgf(content).moves } catch { continue }

      for (let enc of ENCODINGS) {
        try {
          let alt = new TextDecoder(enc).decode(bytes)
          let altMoves = parseSgf(alt).moves
          if (altMoves.length !== utf8Moves.length) {
            silentFailures.push({ name, enc, utf8: utf8Moves.length, alt: altMoves.length })
            break
          }
        } catch {}
      }
    }
    if (silentFailures.length > 0) {
      console.log(`Silent encoding failures (${silentFailures.length}):`)
      for (let f of silentFailures)
        console.log(`  ${f.name}: UTF-8 ${f.utf8} moves, ${f.enc} ${f.alt} moves`)
    }
    expect(silentFailures.length).toBe(0)
  })

  it('sampled SGFs can init QuizEngine and advance', { timeout: 60000 }, async () => {
    entries = entries || await extractRaw(zipBuf)
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
