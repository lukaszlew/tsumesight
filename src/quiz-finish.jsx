import { StarsDisplay } from './scoring.js'
import { getScores } from './db.js'

// End-of-session popup: stars/trophy display, points breakdown table,
// threshold tiers, and a close button. `data` is the popupData field
// produced by computeFinalizeData (effects.js).
export function FinishPopup({ data, onClose }) {
  let counts = [
    { n: data.pointsByGroup.filter(p => p === 10).length, v: 10, cls: 'b-num', cntCls: 'b-count-good' },
    { n: data.pointsByGroup.filter(p => p === 5).length, v: 5, cls: 'b-num', cntCls: 'b-count-bad' },
    { n: data.pointsByGroup.filter(p => p === 0).length, v: 0, cls: 'b-zero', cntCls: 'b-count-bad' },
  ].filter(c => c.n > 0)

  return (
    <div class="finish-popup">
      <StarsDisplay stars={data.stars} wrapClass="finish-stars" trophyClass="finish-trophy" medalClass="finish-medal" offClass="star-off" />
      <div class="finish-total">{data.accPoints + data.speedPoints} points</div>
      <table class="finish-breakdown"><tbody>
        <tr>
          <td class="b-label">groups:</td>
          <td class="b-total-col"><span class="b-total">{data.accPoints}</span></td>
          <td class="b-eq">=</td>
          <td class="b-sum">
            {counts.map((c, i) => <span key={i}>
              {i > 0 && <span class="b-plus"> + </span>}
              <span class={c.cls}>{c.v}</span><span class="b-times">×</span><span class={c.cntCls}>{c.n}</span>
            </span>)}
            <span class="b-unit"> (max {data.maxGroups})</span>
          </td>
        </tr>
        <tr>
          <td class="b-label">time:</td>
          <td class="b-total-col"><span class="b-total">{data.speedPoints}</span></td>
          <td class="b-eq">=</td>
          <td class="b-sum">
            <span class="b-num">{data.maxSpeed}</span><span class="b-unit"> (max)</span>
            <span class="b-eq"> − </span>
            <span class="b-count">{data.elapsedSec}</span><span class="b-unit">s</span>
          </td>
        </tr>
      </tbody></table>
      <table class="finish-thresholds"><tbody>
        <tr class="thresh-points">{[1.0, 0.75, 0.50, 0.25, 0].map((f, i) => <td key={i} class={data.stars === 5 - i ? 'reached' : ''}>{Math.ceil(f * data.parScore)}</td>)}</tr>
        <tr class="thresh-reward">{['🏆', '🏅', '★★★', '★★', '★'].map((label, i) => <td key={i} class={data.stars === 5 - i ? 'reached' : ''}>{label}</td>)}</tr>
      </tbody></table>
      <button class="finish-close" onClick={onClose}>OK</button>
    </div>
  )
}

function formatDate(ts) {
  let d = new Date(ts)
  let months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[d.getMonth()]} ${d.getDate()}`
}

function scoreLabel(s) {
  if (s.correct != null && s.total != null) return `${s.correct}/${s.total}`
  return `${Math.round(s.accuracy * 100)}%`
}

// Score history table shown below the board in finished phase. Rows
// ordered by best accuracy/time; highlights the most recent attempt.
export function StatsBar({ sgfId }) {
  let scores = sgfId ? getScores(sgfId) : []
  let sorted = [...scores].sort((a, b) =>
    b.accuracy - a.accuracy || (a.totalMs || Infinity) - (b.totalMs || Infinity)
  )
  return (
    <div class="score-table-wrap">
      <table class="score-table">
        {sorted.map((s, i) => {
          let isLatest = s === scores[scores.length - 1]
          return (
            <tr key={i} class={isLatest ? 'score-latest' : ''}>
              <td class="score-rank">{i + 1}.</td>
              <td class={`score-frac${s.accuracy >= 1 ? ' score-perfect' : ''}`}>{scoreLabel(s)}</td>
              <td class="score-time">{s.totalMs ? (s.totalMs / 1000).toFixed(1) + 's' : ''}</td>
              <td class="score-date">{s.date ? formatDate(s.date) : ''}</td>
            </tr>
          )
        })}
      </table>
    </div>
  )
}
