import { useId } from 'react'
import MathText from './MathText'
import { parseFunctionGraphEquation } from '../../utils/functionGraph'

function axisDetails(axis) {
  const range = axis?.range || []
  return {
    min: Number(axis?.minimum ?? axis?.min ?? range[0]),
    max: Number(axis?.maximum ?? axis?.max ?? range[1]),
    step: Number(axis?.major_step),
    label: axis?.label,
  }
}

function tickValues(min, max, step) {
  const start = Math.ceil(min / step) * step
  return Array.from({ length: Math.min(100, Math.floor((max - start) / step) + 1) }, (_, index) =>
    Number((start + index * step).toFixed(8)))
}

export default function FunctionGraphBlock({ block }) {
  const coefficients = parseFunctionGraphEquation(block.equation)
  const xAxis = axisDetails(block.x_axis)
  const yAxis = axisDetails(block.y_axis)
  const clipId = `function-plot-${useId().replaceAll(':', '')}`
  if (!coefficients || !Number.isFinite(xAxis.min) || !Number.isFinite(xAxis.max) || xAxis.min >= xAxis.max ||
    !Number.isFinite(yAxis.min) || !Number.isFinite(yAxis.max) || yAxis.min >= yAxis.max ||
    !Number.isFinite(xAxis.step) || xAxis.step <= 0 || !Number.isFinite(yAxis.step) || yAxis.step <= 0) {
    return <div className="unsupported-block">Function graph has an unsupported equation or invalid axes.</div>
  }

  const left = 56; const right = 495; const top = 20; const bottom = 350
  const mapX = (value) => left + ((value - xAxis.min) / (xAxis.max - xAxis.min)) * (right - left)
  const mapY = (value) => bottom - ((value - yAxis.min) / (yAxis.max - yAxis.min)) * (bottom - top)
  const curve = (value) => coefficients.reciprocalCoefficient / value + coefficients.linearCoefficient * value
  const xTicks = tickValues(xAxis.min, xAxis.max, xAxis.step)
  const yTicks = tickValues(yAxis.min, yAxis.max, yAxis.step)
  const epsilon = Math.min(0.005, (xAxis.max - xAxis.min) / 1000)
  const branches = [
    [xAxis.min, Math.min(xAxis.max, -epsilon)],
    [Math.max(xAxis.min, epsilon), xAxis.max],
  ].filter(([start, end]) => end > start)
  const paths = branches.map(([start, end]) => Array.from({ length: 241 }, (_, index) => {
    const value = start + index / 240 * (end - start)
    const clippedValue = Math.max(yAxis.min - 1, Math.min(yAxis.max + 1, curve(value)))
    return `${index ? 'L' : 'M'}${mapX(value)},${mapY(clippedValue)}`
  }).join(' '))
  const axisX = mapX(Math.max(xAxis.min, Math.min(0, xAxis.max)))
  const axisY = mapY(Math.max(yAxis.min, Math.min(0, yAxis.max)))

  return <figure className="diagram-block function-graph-block">
    <svg viewBox="0 0 550 390" role="img" aria-label="Graph of the supplied function on coordinate axes">
      <defs><clipPath id={clipId}><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath></defs>
      {xTicks.map((value) => <line key={`x-${value}`} x1={mapX(value)} y1={top} x2={mapX(value)} y2={bottom} className="grid-line" />)}
      {yTicks.map((value) => <line key={`y-${value}`} x1={left} y1={mapY(value)} x2={right} y2={mapY(value)} className="grid-line" />)}
      <rect x={left} y={top} width={right - left} height={bottom - top} className="grid-border" />
      <line x1={left} y1={axisY} x2={right} y2={axisY} className="axis-line" />
      <line x1={axisX} y1={top} x2={axisX} y2={bottom} className="axis-line" />
      {xTicks.filter((value) => value !== 0).map((value) => <text key={`xt-${value}`} x={mapX(value)} y={bottom + 18} textAnchor="middle" className="graph-tick-label">{value}</text>)}
      {yTicks.filter((value) => value !== 0).map((value) => <text key={`yt-${value}`} x={left - 9} y={mapY(value) + 4} textAnchor="end" className="graph-tick-label">{value}</text>)}
      <text x={axisX - 9} y={axisY + 17} className="graph-tick-label">O</text>
      <text x={right + 12} y={axisY + 5}>{xAxis.label || 'x'}</text>
      <text x={axisX + 9} y={top - 4}>{yAxis.label || 'y'}</text>
      <g clipPath={`url(#${clipId})`}>{paths.map((path, index) => <path key={index} d={path} className="function-curve" />)}</g>
    </svg>
    <figcaption><MathText>{block.equation}</MathText></figcaption>
  </figure>
}
