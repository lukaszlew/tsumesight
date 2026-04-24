import { Goban } from '@sabaki/shudan'

// Decide board orientation and vertex size that fit a puzzle of cols x rows
// in an availW x availH rectangle. Pure function — exported for testing.
export function pickBoardLayout(availW, availH, cols, rows) {
  let normalSize = Math.floor(Math.min(availW / (cols + 0.5), availH / (rows + 0.5)))
  let rotatedSize = Math.floor(Math.min(availW / (rows + 0.5), availH / (cols + 0.5)))
  let rotated = rotatedSize > normalSize * 1.1
  return { rotated, vertexSize: Math.max(1, rotated ? rotatedSize : normalSize) }
}

// Renders the Shudan Goban with its conditional className wrapper. Pure
// presentational component; all input state flows through props.
export function QuizBoard({
  maps, vertexSize, rangeX, rangeY,
  wrongFlash, isFinished, feedbackClass, showingMoveClass,
  onVertexClick, onVertexPointerDown, onVertexPointerUp,
}) {
  let { signMap, markerMap, ghostStoneMap, paintMap } = maps
  return (
    <div class={`board-container${wrongFlash ? ' wrong-flash' : ''}${isFinished ? ' finished' : ''}${feedbackClass}${showingMoveClass}`}>
      {vertexSize > 0 && <Goban
        vertexSize={vertexSize}
        signMap={signMap}
        markerMap={markerMap}
        ghostStoneMap={ghostStoneMap}
        paintMap={paintMap}
        onVertexClick={onVertexClick}
        onVertexPointerDown={onVertexPointerDown}
        onVertexPointerUp={onVertexPointerUp}
        rangeX={rangeX}
        rangeY={rangeY}
        showCoordinates={false}
        fuzzyStonePlacement={false}
        animateStonePlacement={false}
      />}
    </div>
  )
}
