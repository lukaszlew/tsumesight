import { useState, useEffect, useCallback, useRef } from 'preact/hooks'

// Radial marking menu — angles in screen coords (0°=right/E, clockwise)
// 6 arrows at 60° intervals. Going clockwise from straight up:
// nomark(N), 1(NNE), 2(ESE), 3(S), 4(SSW), 5+(WNW). 3 points straight down.
const WHEEL_ZONES = [
  { value: 0, angle: 270, label: '' },
  { value: 1, angle: 330, label: '1' },
  { value: 2, angle: 30,  label: '2' },
  { value: 3, angle: 90,  label: '3' },
  { value: 4, angle: 150, label: '4' },
  { value: 5, angle: 210, label: '5+' },
]

export function getWheelZone(dx, dy) {
  let angle = Math.atan2(dy, dx) * 180 / Math.PI
  if (angle < 0) angle += 360
  let shifted = (angle - 240 + 360) % 360
  return Math.floor(shifted / 60)
}

export function RadialMenu({ cx, cy, activeZone, vertexSize, boardHeight }) {
  let maxDiameter = Math.min(window.innerWidth * 0.5, boardHeight * 0.5)
  let unit = maxDiameter / 6.7
  let rInner = unit * 0.6
  let rOuter = unit * 2
  let rLabel = rOuter + unit * 0.55
  let shaftW = unit * 0.25
  let headW = unit * 0.6
  let headLen = unit * 0.7
  let strokeW = unit * 0.04
  let toRad = Math.PI / 180
  let size = rLabel + unit * 0.8

  let shaftEnd = rOuter - headLen
  let arrowPoints = [
    `${rInner},${-shaftW / 2}`,
    `${shaftEnd},${-shaftW / 2}`,
    `${shaftEnd},${-headW / 2}`,
    `${rOuter},0`,
    `${shaftEnd},${headW / 2}`,
    `${shaftEnd},${shaftW / 2}`,
    `${rInner},${shaftW / 2}`,
  ].join(' ')

  return (
    <svg style={{
      position: 'fixed',
      left: cx - size,
      top: cy - size,
      width: size * 2,
      height: size * 2,
      pointerEvents: 'none',
      zIndex: 1000,
      overflow: 'visible',
    }} viewBox={`${-size} ${-size} ${size * 2} ${size * 2}`}>
      <circle cx={0} cy={0} r={rLabel + vertexSize * 0.5} fill="rgba(255, 255, 255, 0.65)" />
      {WHEEL_ZONES.map(z => {
        let rad = z.angle * toRad
        let lx = Math.cos(rad) * rLabel
        let ly = Math.sin(rad) * rLabel
        let active = activeZone === z.value
        let fill = active ? '#4bf' : '#fff'
        return (
          <g key={z.value}>
            <polygon points={arrowPoints} fill={fill}
              stroke="#000" stroke-width={strokeW} stroke-linejoin="round"
              transform={`rotate(${z.angle})`} />
            {z.label && <text x={lx} y={ly} fill={fill}
              font-size={unit * 0.95} font-weight="800"
              text-anchor="middle" dominant-baseline="central"
              style={{ paintOrder: 'stroke' }}
              stroke="#000" stroke-width={strokeW}>
              {z.label}
            </text>}
          </g>
        )
      })}
    </svg>
  )
}

// Radial wheel marking: swipe or flick from a board intersection selects
// a liberty count. Short flick commits directly; slow press reveals the
// wheel and commits on release.
//
// - enabled: whether the wheel should accept input (true in exercise phase)
// - isLocked(vertex): predicate for pre-marked (non-editable) representatives
// - commitMark(vertex, value): called when user releases / fast-flicks
// - vertexSize: board vertex pixel size (for vicinity threshold)
// - boardRowRef: fallback ref to get board bounding rect when closest
//   .shudan-goban is unavailable
//
// Returns:
//   wheel          — live wheel state {vertex, cx, cy, wcx, wcy, boardHeight, active} or null
//   wheelUsedRef   — ref flag consumed by the board's click handler to
//                    suppress the follow-up click after a wheel interaction
//   onPointerDown  — wire into Goban's onVertexPointerDown
//   onPointerUp    — wire into Goban's onVertexPointerUp (currently no-op
//                    because window listener handles release)
export function useWheel({ enabled, isLocked, commitMark, vertexSize, boardRowRef }) {
  let [wheel, setWheel] = useState(null)
  let wheelRef = useRef(null)
  let wheelUsedRef = useRef(false)

  let onPointerDown = useCallback((evt, vertex) => {
    if (!enabled) return
    if (isLocked(vertex)) return
    // Claim the pointer so Android suppresses its long-press gesture.
    try { evt.currentTarget.setPointerCapture(evt.pointerId) } catch {}
    let rect = evt.currentTarget.getBoundingClientRect()
    let cx = rect.left + rect.width / 2
    let cy = rect.top + rect.height / 2
    let dx = evt.clientX - cx
    let dy = evt.clientY - cy
    let dist = Math.sqrt(dx * dx + dy * dy)
    let vicinityThreshold = vertexSize * 0.4

    wheelUsedRef.current = true
    if (dist > vicinityThreshold) {
      // Fast flick — instant commit without showing wheel
      commitMark(vertex, getWheelZone(dx, dy))
    } else {
      // Show wheel opposite vertically so the finger doesn't cover it.
      let boardEl = evt.currentTarget.closest('.shudan-goban') || boardRowRef.current
      let board = boardEl.getBoundingClientRect()
      let my = board.top + board.height / 2
      let clickedTop = cy < my
      let wcx = board.left + board.width / 2
      let wcy = clickedTop ? board.top + board.height * 3 / 4 : board.top + board.height / 4
      let w = { vertex, cx, cy, wcx, wcy, boardHeight: board.height, active: getWheelZone(dx, dy) }
      wheelRef.current = w
      setWheel(w)
    }
  }, [enabled, isLocked, commitMark, vertexSize, boardRowRef])

  let onPointerUp = useCallback(() => {}, [])

  useEffect(() => {
    function onMove(evt) {
      let w = wheelRef.current
      if (!w) return
      evt.preventDefault()
      let dx = evt.clientX - w.cx
      let dy = evt.clientY - w.cy
      let active = getWheelZone(dx, dy)
      if (active !== w.active) {
        w.active = active
        setWheel({ ...w })
      }
    }
    function onUp(evt) {
      let w = wheelRef.current
      if (!w) return
      wheelRef.current = null
      let dx = evt.clientX - w.cx
      let dy = evt.clientY - w.cy
      commitMark(w.vertex, getWheelZone(dx, dy))
      setWheel(null)
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [vertexSize, commitMark])

  return { wheel, wheelUsedRef, onPointerDown, onPointerUp }
}
