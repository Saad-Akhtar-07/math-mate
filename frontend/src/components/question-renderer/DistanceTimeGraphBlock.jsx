import { timeToMinutes } from '../../utils/distanceTimeGraph'

export default function DistanceTimeGraphBlock({ block }) {
  const ticks = Array.isArray(block.x_axis?.ticks) ? block.x_axis.ticks : []
  const points = Array.isArray(block.polyline) ? block.polyline : []
  const tickMinutes = ticks.map(timeToMinutes)
  const pointMinutes = points.map((point) => timeToMinutes(point?.time))
  const allMinutes = [...tickMinutes, ...pointMinutes]
  const minTime = Math.min(...allMinutes)
  const maxTime = Math.max(...allMinutes)
  const minDistance = Number(block.y_axis?.minimum)
  const maxDistance = Number(block.y_axis?.maximum)

  if (!ticks.length || points.length < 2 || allMinutes.some((time) => time === null) ||
    !Number.isFinite(minDistance) || !Number.isFinite(maxDistance) ||
    minTime >= maxTime || minDistance >= maxDistance ||
    points.some((point) => point?.distance_km == null || !Number.isFinite(Number(point.distance_km)))) {
    return <div className="unsupported-block">Distance–time graph has invalid axis or point data.</div>
  }

  const majorDistances = Array.isArray(block.y_axis?.major_ticks)
    ? block.y_axis.major_ticks.map(Number).filter(Number.isFinite)
    : []
  const minorStep = Number(block.y_axis?.minor_scale_km)
  const minorDistances = Number.isFinite(minorStep) && minorStep > 0
    ? Array.from({ length: Math.min(200, Math.floor((maxDistance - minDistance) / minorStep) + 1) }, (_, index) => minDistance + index * minorStep)
    : []
  const left = 62; const right = 500; const top = 30; const bottom = 300
  const x = (time) => left + ((time - minTime) / (maxTime - minTime)) * (right - left)
  const y = (distance) => bottom - ((distance - minDistance) / (maxDistance - minDistance)) * (bottom - top)
  const plottedPoints = points.map((point, index) => ({
    x: x(pointMinutes[index]),
    y: y(Number(point.distance_km)),
    label: point.label,
  }))

  return <figure className="diagram-block distance-time-graph">
    <svg viewBox="0 0 560 350" role="img" aria-label="Distance–time graph with labelled points">
      {minorDistances.filter((distance) => distance >= minDistance && distance <= maxDistance && !majorDistances.includes(distance)).map((distance) =>
        <line key={`minor-${distance}`} x1={left} y1={y(distance)} x2={right} y2={y(distance)} className="grid-line minor-grid-line" />)}
      {majorDistances.filter((distance) => Number.isFinite(Number(distance)) && distance >= minDistance && distance <= maxDistance).map((distance) =>
        <line key={`major-${distance}`} x1={left} y1={y(distance)} x2={right} y2={y(distance)} className="grid-line" />)}
      {tickMinutes.map((time, index) => <g key={`${ticks[index]}-${index}`}>
        <line x1={x(time)} y1={top} x2={x(time)} y2={bottom} className="grid-line" />
        <line x1={x(time)} y1={bottom} x2={x(time)} y2={bottom + 5} className="tick" />
        <text x={x(time)} y={bottom + 22} textAnchor="middle" className="axis-tick-label">{ticks[index]}</text>
      </g>)}
      <line x1={left} y1={bottom} x2={right + 9} y2={bottom} className="axis-line" />
      <line x1={left} y1={bottom} x2={left} y2={top - 9} className="axis-line" />
      {majorDistances.filter((distance) => Number.isFinite(Number(distance)) && distance >= minDistance && distance <= maxDistance).map((distance) =>
        <g key={`label-${distance}`}>
          <line x1={left - 5} y1={y(distance)} x2={left} y2={y(distance)} className="tick" />
          <text x={left - 10} y={y(distance) + 4} textAnchor="end" className="axis-tick-label">{distance}</text>
        </g>)}
      <text x={left} y="17" className="axis-title">{block.y_axis?.label || 'Distance (km)'}</text>
      <polyline points={plottedPoints.map((point) => `${point.x},${point.y}`).join(' ')} className="graph-segment distance-time-line" />
      {plottedPoints.map((point, index) => <g key={`${point.label || 'point'}-${index}`}>
        <circle cx={point.x} cy={point.y} r="3.5" className="distance-time-point" />
        {point.label && <text x={point.x + (index === plottedPoints.length - 1 ? -9 : 9)} y={point.y - 10} textAnchor={index === plottedPoints.length - 1 ? 'end' : 'start'} className="point-label">{point.label}</text>}
      </g>)}
    </svg>
    <figcaption>{block.x_axis?.label || 'Time'}</figcaption>
  </figure>
}
