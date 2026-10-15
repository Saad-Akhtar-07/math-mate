const triangleHeight = Math.sqrt(3) / 2

function trianglesForPattern(order) {
  const upward = []
  const downward = []
  for (let row = 0; row < order; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      const apexX = order / 2 - row / 2 + column
      upward.push(`${apexX},${row * triangleHeight} ${apexX - 0.5},${(row + 1) * triangleHeight} ${apexX + 0.5},${(row + 1) * triangleHeight}`)
    }
    for (let column = 0; column < row; column += 1) {
      const leftX = order / 2 - row / 2 + column
      downward.push(`${leftX},${row * triangleHeight} ${leftX + 1},${row * triangleHeight} ${leftX + 0.5},${(row + 1) * triangleHeight}`)
    }
  }
  return { upward, downward }
}

export default function TriangularPatternSequenceBlock({ block }) {
  const patterns = Array.isArray(block.counts) ? block.counts : []
  if (!patterns.length || patterns.some((pattern) => !Number.isInteger(Number(pattern.pattern)) || Number(pattern.pattern) < 1)) {
    return <div className="unsupported-block">Triangular pattern sequence needs numbered patterns.</div>
  }
  return <figure className="triangular-pattern-sequence">
    <div className="triangular-patterns">
      {patterns.map((pattern) => {
        const order = Number(pattern.pattern)
        const { upward, downward } = trianglesForPattern(order)
        return <div className="triangular-pattern" key={order}>
          <svg viewBox={`-0.08 -0.08 ${order + 0.16} ${order * triangleHeight + 0.16}`} style={{ width: `${order * 28}px`, height: `${order * 28 * triangleHeight}px` }} role="img" aria-label={`Pattern ${order}, triangular grid`}>
            {upward.map((points, index) => <polygon key={`up-${index}`} points={points} className="pattern-white-triangle" />)}
            {downward.map((points, index) => <polygon key={`down-${index}`} points={points} className="pattern-grey-triangle" />)}
          </svg>
          <strong>Pattern {order}</strong>
        </div>
      })}
    </div>
  </figure>
}
