function numericTicks(axis) {
  return Array.isArray(axis?.major_ticks) ? axis.major_ticks.map(Number) : []
}

function minorTicks(ticks) {
  if (ticks.length < 2) return []
  return ticks.slice(0, -1).flatMap((start, index) =>
    Array.from({ length: 9 }, (_, offset) => start + (ticks[index + 1] - start) * (offset + 1) / 10))
}

export default function PracticalLineGraphBlock({ block }) {
  const xAxis = block.x_axis || {}
  const yAxis = block.y_axis || {}
  const xMin = Number(xAxis.minimum)
  const xMax = Number(xAxis.maximum)
  const yMin = Number(yAxis.minimum)
  const yMax = Number(yAxis.maximum)
  const xTicks = numericTicks(xAxis)
  const yTicks = numericTicks(yAxis)
  const line = block.printed_line?.passes_visually_through
  if (![xMin, xMax, yMin, yMax].every(Number.isFinite) || xMax <= xMin || yMax <= yMin ||
    xTicks.length < 2 || yTicks.length < 2 || !Array.isArray(line) || line.length < 2 ||
    line.some((point) => !Array.isArray(point) || point.length !== 2 || !point.every((value) => Number.isFinite(Number(value))))) {
    return <div className="unsupported-block">Practical line graph needs valid axes, ticks, and line points.</div>
  }

  const left = 62; const right = 505; const top = 28; const bottom = 332
  const x = (value) => left + ((Number(value) - xMin) / (xMax - xMin)) * (right - left)
  const y = (value) => bottom - ((Number(value) - yMin) / (yMax - yMin)) * (bottom - top)
  return <figure className="diagram-block practical-line-graph">
    <svg viewBox="0 0 560 380" role="img" aria-label="Line graph showing fee per day against mass">
      {minorTicks(xTicks).map((value, index) => <line key={`minor-x-${index}`} x1={x(value)} y1={top} x2={x(value)} y2={bottom} className="grid-line minor-grid-line" />)}
      {minorTicks(yTicks).map((value, index) => <line key={`minor-y-${index}`} x1={left} y1={y(value)} x2={right} y2={y(value)} className="grid-line minor-grid-line" />)}
      {xTicks.map((value, index) => <g key={`x-${index}`}>
        <line x1={x(value)} y1={top} x2={x(value)} y2={bottom} className="grid-line" />
        <text x={x(value)} y={bottom + 20} textAnchor="middle" className="graph-tick-label">{value}</text>
      </g>)}
      {yTicks.map((value, index) => <g key={`y-${index}`}>
        <line x1={left} y1={y(value)} x2={right} y2={y(value)} className="grid-line" />
        <text x={left - 10} y={y(value) + 4} textAnchor="end" className="graph-tick-label">{value}</text>
      </g>)}
      <rect x={left} y={top} width={right - left} height={bottom - top} className="grid-border" />
      <line x1={left} y1={bottom} x2={right + 9} y2={bottom} className="axis-line" />
      <line x1={left} y1={bottom} x2={left} y2={top - 9} className="axis-line" />
      <polyline points={line.map((point) => `${x(point[0])},${y(point[1])}`).join(' ')} className="graph-segment practical-printed-line" />
      <text x={left} y="18" className="graph-axis-title">{yAxis.label}</text>
    </svg>
    <figcaption>{xAxis.label}</figcaption>
  </figure>
}
