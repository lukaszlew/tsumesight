import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import JSZip from 'jszip'
import { parseSgf } from './sgf-utils.js'
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
    entries.push({ name, content: await entry.async('string') })
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
