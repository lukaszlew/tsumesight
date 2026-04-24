import { StarsDisplay } from './scoring.js'
import { getScores } from './db.js'

// End-of-session popup: stars/trophy display, points breakdown table,
// threshold tiers, and a close button. `data` is the popupData field
// produced by computeFinalizeData (effects.js).
export function FinishPopup({ data, onClose }) {
  let schedule = data.schedule
  let lastIdx = schedule.length - 1
  let buckets = schedule
    .map((v, i) => ({ v, i, n: data.pointsByGroup.filter(p => p === v).length }))
    .filter(b => b.n > 0)
  let mistakeLabel = i => {
    if (i === lastIdx) return 'never'
    let n = i + 1
    let suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'
    return `${n}${suffix} try`
  }
  return (
    <div class="finish-popup">
      <StarsDisplay stars={data.stars} wrapClass="finish-stars" trophyClass="finish-trophy" medalClass="finish-medal" offClass="star-off" />
      <div class="finish-total">{data.accPoints + data.speedPoints} points</div>
      <table class="finish-breakdown"><tbody>
        <tr>
          <td class="b-label">groups:</td>
          <td class="b-sum"><span class="b-total">{data.accPoints}</span></td>
          <td class="b-schedule">(max {data.maxGroups})</td>
        </tr>
        {buckets.map((b, i) => (
          <tr key={i} class="b-bucket-row">
            <td class={i === 0 ? 'b-eq' : 'b-plus'}>{i === 0 ? '=' : '+'}</td>
            <td class="b-bucket">
              <span class="b-bucket-n">{b.n}</span>
              <span class="b-times">×</span>
              <span class={b.v === 0 ? 'b-zero' : 'b-num'}>{b.v}</span>
            </td>
            <td class="b-schedule">({mistakeLabel(b.i)})</td>
          </tr>
        ))}
        <tr>
          <td class="b-label">time:</td>
          <td class="b-sum"><span class="b-total">{data.speedPoints}</span></td>
          <td class="b-schedule">(max {data.maxSpeed} − took {data.elapsedSec}s)</td>
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
