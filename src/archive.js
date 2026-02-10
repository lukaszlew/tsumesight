import JSZip from 'jszip'
import { decodeSgf } from './sgf-utils.js'

const ARCHIVE_EXTENSIONS = ['.zip', '.tar.gz', '.tgz', '.tar']

export function isArchive(filename) {
  let lower = filename.toLowerCase()
  return ARCHIVE_EXTENSIONS.some(ext => lower.endsWith(ext))
}

// Returns [{name, content}] — name includes path, content is string
export async function extractSgfs(file) {
  let lower = file.name.toLowerCase()
  let entries = []
  if (lower.endsWith('.zip')) entries = await extractZip(file)
  else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) entries = await extractTarGz(file)
  else if (lower.endsWith('.tar')) entries = await extractTar(await file.arrayBuffer())
  return flattenSingleRoot(entries)
}

// If all entries share a single top-level directory, strip it
function flattenSingleRoot(entries) {
  if (entries.length === 0) return entries
  let roots = new Set(entries.map(e => e.name.split('/')[0]))
  if (roots.size !== 1) return entries
  let prefix = [...roots][0] + '/'
  if (!entries.every(e => e.name.startsWith(prefix))) return entries
  return entries.map(e => ({ ...e, name: e.name.slice(prefix.length) }))
}

async function extractZip(file) {
  let zip = await JSZip.loadAsync(file)
  let results = []
  for (let [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    if (!name.toLowerCase().endsWith('.sgf')) continue
    let content = decodeSgf(await entry.async('uint8array'))
    results.push({ name, content })
  }
  return results
}

async function extractTarGz(file) {
  let ds = new DecompressionStream('gzip')
  let decompressed = file.stream().pipeThrough(ds)
  let buf = await new Response(decompressed).arrayBuffer()
  return extractTar(buf)
}

function extractTar(buf) {
  let results = []
  let offset = 0
  let view = new Uint8Array(buf)
  while (offset + 512 <= buf.byteLength) {
    // Empty block = end of archive
    if (view.slice(offset, offset + 512).every(b => b === 0)) break
    let name = readString(view, offset, 100)
    let size = parseInt(readString(view, offset + 124, 12).trim(), 8) || 0
    // UStar prefix extends the name
    let prefix = readString(view, offset + 345, 155)
    if (prefix) name = prefix + '/' + name
    offset += 512
    if (name.toLowerCase().endsWith('.sgf') && size > 0) {
      let content = decodeSgf(view.slice(offset, offset + size))
      results.push({ name, content })
    }
    offset += Math.ceil(size / 512) * 512
  }
  return results
}

function readString(view, offset, len) {
  let end = offset + len
  let nullIdx = view.indexOf(0, offset)
  if (nullIdx >= offset && nullIdx < end) end = nullIdx
  return new TextDecoder().decode(view.slice(offset, end))
}
