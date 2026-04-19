#!/usr/bin/env node
// Convert a TsumeSight export zip into committed test fixtures.
//
// Usage:
//   node scripts/zip-to-fixtures.mjs <path-to-tsumesight-*.zip> [--out fixtures/]
//
// Every replay in the export zip becomes one fixture file under `fixtures/`:
//
//   v:3 replays (enriched)  → full fixture with all goldens
//   v:2 verbose (has event.kind)
//                           → partial fixture with scoreEntry golden only
//                             (config/viewport/other goldens null, marked source:'v2')
//   v:2 compact (has event.a / event.ex, no event.kind)
//   v:undefined (pre-v2)    → skipped (legacy format; decoder deferred)
//
// Fixtures are self-contained: SGF content, filename, path, events, and
// goldens all in one file. Idempotent: re-running overwrites.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import JSZip from 'jszip'
import { QuizSession } from '../src/session.js'

const EVENT_SCHEMA_VERSION = 2
const SCHEMA_VERSION = 1

function usage(code = 1) {
  console.error('Usage: node scripts/zip-to-fixtures.mjs <path-to-zip> [--out fixtures/]')
  process.exit(code)
}

let args = process.argv.slice(2)
let zipPath = null
let outDir = 'fixtures'
for (let i = 0; i < args.length; i++) {
  let a = args[i]
  if (a === '--out') outDir = args[++i]
  else if (a === '--help' || a === '-h') usage(0)
  else if (!zipPath) zipPath = a
  else usage()
}
if (!zipPath) usage()
if (!fs.existsSync(zipPath)) {
  console.error(`Not found: ${zipPath}`)
  process.exit(2)
}

function sanitize(s) {
  return s.replace(/\.sgf$/i, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

function sha256Hex(s) {
  return 'sha256:' + crypto.createHash('sha256').update(s).digest('hex')
}

function classifyReplay(parsed) {
  if (!parsed || typeof parsed !== 'object') return 'skip'
  if (Array.isArray(parsed)) return 'skip'  // v:undefined format (bare array)
  if (parsed.v === 3) return 'v3'
  if (parsed.v !== 2) return 'skip'
  let events = parsed.events
  if (!Array.isArray(events) || events.length === 0) return 'skip'
  let hasKind = events.some(e => 'kind' in e)
  let hasCompact = events.some(e => 'a' in e || 'ex' in e || 's' in e || 'cmp' in e || 'sw' in e)
  if (hasKind && !hasCompact) return 'v2-verbose'
  return 'skip'  // compact or mixed
}

function scoreEntryByDate(kv, sgfId, date) {
  let raw = kv[`scores:${sgfId}`]
  if (!raw) return null
  try {
    let arr = JSON.parse(raw)
    return arr.find(s => s.date === date) ?? null
  } catch { return null }
}

async function main() {
  let zipBuf = fs.readFileSync(zipPath)
  let zip = await JSZip.loadAsync(zipBuf)
  let jsonFile = zip.file('tsumesight.json')
  if (!jsonFile) {
    console.error('Expected tsumesight.json inside the zip')
    process.exit(3)
  }
  let data = JSON.parse(await jsonFile.async('text'))
  let sgfsById = new Map(data.sgfs.map(s => [String(s.id), s]))
  let replayKeys = Object.keys(data.kv).filter(k => k.startsWith('replay:'))

  let counts = { v3: 0, v2verbose: 0, skipped: 0, missingSgf: 0, replayFailed: 0 }
  fs.mkdirSync(outDir, { recursive: true })
  let written = []

  // Validate a candidate fixture by trying to fold its events through the
  // current QuizSession. Replays recorded under older rules (pre-commit
  // 3b30899, where advance-to-activate-exercise was implicit) will throw;
  // those are skipped so the fixture corpus only contains round-trippable
  // sessions.
  function replaysCleanly(sgfContent, config, events) {
    try {
      let s = new QuizSession(sgfContent, config)
      for (let e of events) s.applyEvent(e)
      return true
    } catch { return false }
  }

  for (let k of replayKeys) {
    let [, sgfId, dateStr] = k.split(':')
    let date = parseInt(dateStr)
    let parsed
    try { parsed = JSON.parse(data.kv[k]) } catch { counts.skipped++; continue }
    let kind = classifyReplay(parsed)
    if (kind === 'skip') { counts.skipped++; continue }

    let sgf = sgfsById.get(String(sgfId))
    if (!sgf) { counts.missingSgf++; continue }

    let candidateConfig = kind === 'v3' ? parsed.config : { maxSubmits: 2, maxQuestions: 2 }
    if (!replaysCleanly(sgf.content, candidateConfig, parsed.events)) {
      counts.replayFailed++
      continue
    }

    let fixture
    if (kind === 'v3') {
      fixture = {
        schemaVersion: SCHEMA_VERSION,
        sgf: {
          content: sgf.content,
          filename: sgf.filename,
          path: sgf.path || '',
          contentHash: sha256Hex(sgf.content),
        },
        config: parsed.config,
        recorded: {
          at: new Date(date).toISOString(),
          eventSchemaVersion: EVENT_SCHEMA_VERSION,
          viewport: parsed.viewport ? { w: parsed.viewport.w, h: parsed.viewport.h } : null,
          rotated: parsed.viewport?.rotated ?? null,
          source: 'v3',
        },
        events: parsed.events,
        goldens: parsed.goldens,
      }
      counts.v3++
    } else {
      let scoreEntry = scoreEntryByDate(data.kv, sgfId, date)
      fixture = {
        schemaVersion: SCHEMA_VERSION,
        sgf: {
          content: sgf.content,
          filename: sgf.filename,
          path: sgf.path || '',
          contentHash: sha256Hex(sgf.content),
        },
        // Config at record time wasn't stored; assume current defaults.
        config: { maxSubmits: 2, maxQuestions: 2 },
        recorded: {
          at: new Date(date).toISOString(),
          eventSchemaVersion: EVENT_SCHEMA_VERSION,
          viewport: null,
          rotated: null,
          source: 'v2-verbose',
        },
        events: parsed.events,
        goldens: {
          scoreEntry,
          finalMarks: null,
          submitResults: null,
          changedGroupsVertices: null,
        },
      }
      counts.v2verbose++
    }

    let nameBase = sanitize(sgf.filename)
    let outFile = path.join(outDir, `${nameBase}--${date}.events.json`)
    fs.writeFileSync(outFile, JSON.stringify(fixture, null, 2) + '\n')
    written.push(outFile)
  }

  console.log(`Wrote ${written.length} fixture${written.length === 1 ? '' : 's'} to ${outDir}/`)
  console.log(`  v:3 full goldens:    ${counts.v3}`)
  console.log(`  v:2 verbose partial: ${counts.v2verbose}`)
  console.log(`  skipped (compact / undefined / other): ${counts.skipped}`)
  if (counts.missingSgf > 0) console.log(`  skipped (sgf missing from export): ${counts.missingSgf}`)
  if (counts.replayFailed > 0) console.log(`  skipped (events don't round-trip under current rules): ${counts.replayFailed}`)
}

main().catch(err => {
  console.error(err)
  process.exit(4)
})
