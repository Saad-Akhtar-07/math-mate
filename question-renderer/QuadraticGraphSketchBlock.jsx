import { useId } from 'react'

export default function QuadraticGraphSketchBlock({ block }) {
  const roots = Array.isArray(block.x_intercepts) ? block.x_intercepts : []
  const first = Number(roots[0]?.value)
  const second = Number(roots[1]?.value)
  const intercept = Number(block.y_intercept?.value)
  const clipId = `quadratic-sketch-${useId().replaceAll(':', '')}`
  if (roots.length !== 2 || !Number.isFinite(first) || !Number.isFinite(second) || first === second || !Number.isFinite(intercept) || !intercept) {
    return <div className="unsupported-block">Quadratic sketch needs two distinct intercepts and a nonzero y-intercept.</div>
  }

  const coefficient = intercept / (first * second)
  if (!Number.isFinite(coefficient)) return <div className="unsupported-block">Quadratic sketch intercepts are inconsistent.</div>
  const quadratic = (value) => coefficient * (value - first) * (value - second)
  const vertexValue = quadratic((first + second) / 2)
  const span = Math.max(Math.abs(second - first), 1)
  const minX = Math.min(first, second, 0) - span * 0.18
  const maxX = Math.max(first, second, 0) + span * 0.18
  const left = 48; const right = 492; const top = 30; const bottom = 294; const axisY = 245
  const axisX = left + ((0 - minX) / (maxX - minX)) * (right - left)
  const mapX = (value) => left + ((value - minX) / (maxX - minX)) * (right - left)
  const scaleY = 145 / Math.max(Math.abs(vertexValue), Math.abs(intercept), 1)
  const mapY = (value) => axisY - value * scaleY
  const curveStart = Math.min(first, second) - span * 0.09
  const curveEnd = Math.max(first, second) + span * 0.09
  const path = Array.from({ length: 181 }, (_, index) => {
    const value = curveStart + index / 180 * (curveEnd - curveStart)
    return `${index ? 'L' : 'M'}${mapX(value)},${mapY(quadratic(value))}`
  }).join(' ')

  return <figure className="diagram-block quadratic-sketch-block">
    <svg viewBox="0 0 540 325" role="img" aria-label="Quadratic graph sketch with labelled y-intercept">
      <defs><clipPath id={clipId}><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath></defs>
      <line x1={left} y1={axisY} x2={right + 8} y2={axisY} className="axis-line" />
      <polyline points={`${right - 2},${axisY - 6} ${right + 8},${axisY} ${right - 2},${axisY + 6}`} className="axis-arrow" />
      <line x1={axisX} y1={bottom} x2={axisX} y2={top - 8} className="axis-line" />
      <polyline points={`${axisX - 6},${top + 2} ${axisX},${top - 8} ${axisX + 6},${top + 2}`} className="axis-arrow" />
      <path d={path} className="quadratic-sketch-curve" clipPath={`url(#${clipId})`} />
      <text x={right + 15} y={axisY + 5}>x</text>
      <text x={axisX + 9} y={top - 4}>y</text>
      <text x={axisX - 12} y={axisY + 17}>{block.origin_label || 'O'}</text>
      {block.y_intercept?.printed_label && <text x={axisX - 10} y={mapY(intercept) + 4} textAnchor="end">{intercept}</text>}
      {roots.filter((point) => point.printed_label).map((point, index) => <text key={index} x={mapX(Number(point.value))} y={axisY + 20} textAnchor="middle">{point.value}</text>)}
      {block.not_to_scale && <text x={right - 75} y={bottom + 17} className="not-scale">NOT TO SCALE</text>}
    </svg>
  </figure>
}
