// Tile presentation components for the library grid. Each tile knows
// how to display itself given the minimum required props; no DB
// access happens outside FileTile's per-tile score lookup.

import { StarsDisplay, starsFromScore } from './scoring.js'
import { getBestScore } from './db.js'

// Split long dir names into two lines at the first comma / ' - ' / '-'.
// Returns a React node — Fragment with <br/> when split, plain string
// otherwise.
function splitDirName(name) {
  let i = name.indexOf(',')
  if (i === -1) i = name.indexOf(' - ')
  if (i === -1) i = name.indexOf('-')
  if (i === -1) return name
  let sep = name[i] === ',' ? ', ' : name.slice(i).startsWith(' - ') ? ' - ' : '-'
  let line1 = name.slice(0, i).trim()
  let line2 = name.slice(i + sep.length).trim()
  return <>{line1}<br />{line2}</>
}

// Tint for partial-accuracy tiles.
function scoreColor(accuracy) {
  if (accuracy >= 0.8) return '#c8a060'
  if (accuracy >= 0.5) return '#c80'
  return '#c44'
}

// Long-press pointer helper — fires `callback` after `ms` of hold.
function useLongPress(callback, ms = 500) {
  let timer = null
  let onDown = (e) => {
    timer = setTimeout(() => { timer = null; callback(e) }, ms)
  }
  let cancel = () => { if (timer) { clearTimeout(timer); timer = null } }
  return { onPointerDown: onDown, onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel }
}

function DirCount({ solved, total }) {
  return (
    <div class="dir-count" title={`${solved} of ${total} solved`}>
      <span class="dir-count-num">{solved}</span>
      <span class="dir-count-sep">/</span>
      <span class="dir-count-den">{total}</span>
    </div>
  )
}

export function DirTile({ name, stats, onOpen, onRename, onDelete }) {
  let { solved, total } = stats
  return (
    <div class={`tile dir-tile${solved === total ? ' dir-complete' : ''}`} onClick={onOpen}>
      <DirCount solved={solved} total={total} />
      <div class="tile-name">{splitDirName(name)}</div>
      <div class="dir-actions">
        <button class="dir-action-btn" title="Rename folder" onClick={e => { e.stopPropagation(); onRename() }}>&#x270E;</button>
        <button class="dir-action-btn dir-action-delete" title="Delete folder" onClick={e => { e.stopPropagation(); onDelete() }}>&times;</button>
      </div>
    </div>
  )
}

export function DirHeaderTile({ name, solved, total }) {
  return (
    <div class={`dir-header-tile${solved === total ? ' dir-complete' : ''}`}>
      <DirCount solved={solved} total={total} />
      <div class="tile-name">{splitDirName(name)}</div>
    </div>
  )
}

export function FileTile({ sgf, onSelect, onDelete }) {
  let best = getBestScore(sgf.id)
  let stars = best ? starsFromScore(best) : 0
  let lp = useLongPress(onDelete)
  return (
    <div class={`tile file-tile${sgf.solved ? ' tile-solved' : ''}`} onClick={onSelect} {...lp}>
      <span class="tile-num" title="Number of moves">{sgf.moveCount || '?'}</span>
      {stars > 0
        ? <span class="tile-stars" title={`${stars}/5 stars`}>
            <StarsDisplay stars={stars} wrapClass="" trophyClass="tile-trophy" medalClass="tile-medal" offClass="star-off" onClass="star-on" />
          </span>
        : <span class={`tile-acc${best && best.accuracy >= 1 ? ' tile-perfect' : ''}`}
            title="Best score"
            style={best && best.accuracy < 1 ? { color: scoreColor(best.accuracy) } : undefined}
          >{best ? Math.round(best.accuracy * 100) + '%' : ''}</span>
      }
    </div>
  )
}
