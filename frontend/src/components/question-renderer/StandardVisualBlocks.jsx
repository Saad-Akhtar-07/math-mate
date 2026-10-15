import { useId } from 'react'
import { fitPatternViewBox, validateStandardBlock } from '../../utils/standardContentBlocks'
import { layoutGraphLabels } from '../../utils/graphLabelLayout'
import MathText from './MathText'

const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const palette = { black: 'var(--diagram-ink)', gray: 'var(--diagram-muted)', light_gray: 'var(--diagram-grid)', white: 'var(--diagram-paper)', none: 'none' }
const color = (name, fallback) => palette[name] ?? fallback
const lineStyle = (element) => element.line_style === 'dashed' ? '5 4' : undefined

function smoothPath(points) {
  if (!points.length) return ''
  if (points.length < 3) return `M ${points.map(([x, y]) => `${x} ${y}`).join(' L ')}`
  let path = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const before = points[Math.max(0, i - 1)]
    const start = points[i]
    const end = points[i + 1]
    const after = points[Math.min(points.length - 1, i + 2)]
    const c1 = [start[0] + (end[0] - before[0]) / 6, start[1] + (end[1] - before[1]) / 6]
    const c2 = [end[0] - (after[0] - start[0]) / 6, end[1] - (after[1] - start[1]) / 6]
    path += ` C ${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${end[0]} ${end[1]}`
  }
  return path
}

function DrawingElement({ element, map = (point) => point, labelPlacement }) {
  const stroke = color(element.stroke, 'var(--diagram-ink)')
  const fill = color(element.fill, 'none')
  const common = { stroke, fill, strokeWidth: element.stroke_width ?? 2, strokeDasharray: lineStyle(element) }
  const mapped = (point) => map(point)
  if (element.type === 'line') {
    const [x1, y1] = mapped(element.from); const [x2, y2] = mapped(element.to)
    return <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
  }
  if (element.type === 'polyline' || element.type === 'polygon' || element.type === 'curve') {
    const points = element.points.map(mapped)
    if (element.type === 'curve') return <path d={smoothPath(points)} {...common} />
    const Component = element.type
    return <Component points={points.map((point) => point.join(',')).join(' ')} {...common} />
  }
  if (element.type === 'circle' || element.type === 'point') {
    const [cx, cy] = mapped(element.at)
    return <circle cx={cx} cy={cy} r={element.radius ?? (element.type === 'point' ? 3.5 : 9)} {...common} fill={color(element.fill, element.type === 'point' ? 'var(--diagram-ink)' : 'var(--diagram-paper)')} />
  }
  if (element.type === 'rect') {
    const [x1, y1] = mapped(element.from); const [x2, y2] = mapped(element.to)
    return <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} {...common} />
  }
  if (element.type === 'label') {
    const [mappedX, mappedY] = mapped(element.at)
    const { x = mappedX, y = mappedY, anchor = element.anchor ?? 'middle' } = labelPlacement || {}
    return <text x={x} y={y} textAnchor={anchor} fill={color(element.fill, 'var(--diagram-ink)')} stroke="var(--diagram-paper)" strokeWidth="3" strokeLinejoin="round" paintOrder="stroke" className="standard-visual-label">{element.text}</text>
  }
  return null
}

function tickValues(axis) {
  if (Array.isArray(axis.ticks)) return axis.ticks.map((tick) => typeof tick === 'number' ? { value: tick, label: String(tick) } : tick)
  const [min, max] = axis.range
  const step = axis.major_step
  const count = Math.min(100, Math.floor((max - min) / step + 1e-9) + 1)
  return Array.from({ length: count }, (_, index) => {
    const value = Number((min + index * step).toFixed(8))
    return { value, label: String(value) }
  })
}

function minorValues(axis) {
  if (!axis.minor_step) return []
  const [min, max] = axis.range
  const count = Math.min(250, Math.floor((max - min) / axis.minor_step + 1e-9) + 1)
  return Array.from({ length: count }, (_, index) => min + index * axis.minor_step)
}

// SVG text does not pass through MathText. Older graph data wraps single-letter
// axis names in inline-math delimiters, so display the letter itself.
const axisLabel = (label) => /^\$[A-Za-z]\$$/.test(label) ? label.slice(1, -1) : label

function polynomialPoints(element, axis) {
  const [min, max] = element.domain ?? axis.range
  return Array.from({ length: 161 }, (_, index) => {
    const x = min + (max - min) * index / 160
    const y = element.coefficients.reduce((total, coefficient) => total * x + coefficient, 0)
    return [x, y]
  })
}

export function StandardGraphBlock({ block }) {
  const clipId = useId().replaceAll(':', '')
  if (validateStandardBlock(block).length) return <div className="unsupported-block">Graph data does not match the standard format. See validation warnings.</div>
  const xAxis = block.x_axis
  const yAxis = block.y_axis
  if (!xAxis?.range || !yAxis?.range) return <div className="unsupported-block">Graph needs x_axis and y_axis ranges.</div>
  const [xMin, xMax] = xAxis.range; const [yMin, yMax] = yAxis.range
  const left = 70; const right = 510; const top = 30; const bottom = 310
  const map = ([x, y]) => [left + (x - xMin) * (right - left) / (xMax - xMin), bottom - (y - yMin) * (bottom - top) / (yMax - yMin)]
  const xTicks = tickValues(xAxis); const yTicks = tickValues(yAxis)
  const xMinor = minorValues(xAxis); const yMinor = minorValues(yAxis)
  const axisY = map([0, Math.max(yMin, Math.min(0, yMax))])[1]
  const axisX = map([Math.max(xMin, Math.min(0, xMax)), 0])[0]
  const elements = block.elements ?? []
  const background = elements.filter((element) => element.layer === 'background')
  const foreground = elements.filter((element) => element.layer !== 'background')
  const labelPlacements = layoutGraphLabels(foreground, map, { width: 560, height: 365, plotBottom: bottom, domain: xAxis.range })
  const draw = (element, index) => {
    const shape = element.type === 'polynomial' ? { ...element, type: 'curve', points: polynomialPoints(element, xAxis) } : element
    return <DrawingElement element={shape} map={map} labelPlacement={labelPlacements.get(element)} key={index} />
  }
  return <figure className="diagram-block standard-graph">
    <svg viewBox="0 0 560 365" role="img" aria-label={block.alt || 'Coordinate graph'}>
      <defs><clipPath id={clipId}><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>{background.map(draw)}</g>
      {block.show_grid !== false && <g className="standard-graph-grid">
        {xMinor.map((value, index) => <line className="standard-minor-grid" key={`xm${index}`} x1={map([value, 0])[0]} y1={top} x2={map([value, 0])[0]} y2={bottom} />)}
        {yMinor.map((value, index) => <line className="standard-minor-grid" key={`ym${index}`} x1={left} y1={map([0, value])[1]} x2={right} y2={map([0, value])[1]} />)}
        {xTicks.map((tick, index) => <line key={`xg${index}`} x1={map([tick.value, 0])[0]} y1={top} x2={map([tick.value, 0])[0]} y2={bottom} />)}
        {yTicks.map((tick, index) => <line key={`yg${index}`} x1={left} y1={map([0, tick.value])[1]} x2={right} y2={map([0, tick.value])[1]} />)}
      </g>}
      <rect x={left} y={top} width={right - left} height={bottom - top} className="standard-graph-border" />
      <g clipPath={`url(#${clipId})`}>{foreground.filter((element) => element.type !== 'label').map(draw)}</g>
      {block.show_axes !== false && <g className="standard-graph-axes"><line x1={left} y1={axisY} x2={right + 7} y2={axisY} /><line x1={axisX} y1={bottom} x2={axisX} y2={top - 7} /></g>}
      {block.show_tick_labels !== false && <g className="standard-graph-ticks">
        {xTicks.filter((tick) => !(block.origin_label && tick.value === 0)).map((tick, index) => <text key={`xt${index}`} x={map([tick.value, 0])[0]} y={axisY + 20} textAnchor="middle">{tick.label}</text>)}
        {yTicks.filter((tick) => !(block.origin_label && tick.value === 0)).map((tick, index) => <text key={`yt${index}`} x={axisX - 9} y={map([0, tick.value])[1] + (tick.value === 0 && xTicks.some((xTick) => xTick.value === 0) ? -8 : 4)} textAnchor="end">{tick.label}</text>)}
      </g>}
      {block.origin_label && <text x={axisX - 10} y={axisY + 18} className="standard-visual-label" textAnchor="end">{block.origin_label}</text>}
      {foreground.filter((element) => element.type === 'label').map((element, index) => <DrawingElement element={element} map={map} labelPlacement={labelPlacements.get(element)} key={`label${index}`} />)}
      {xAxis.label && <text x={(left + right) / 2} y="353" textAnchor="middle" className="standard-axis-label">{axisLabel(xAxis.label)}{xAxis.unit ? ` (${xAxis.unit})` : ''}</text>}
      {yAxis.label && <text x="22" y={(top + bottom) / 2} textAnchor="middle" transform={`rotate(-90 22 ${(top + bottom) / 2})`} className="standard-axis-label">{axisLabel(yAxis.label)}{yAxis.unit ? ` (${yAxis.unit})` : ''}</text>}
      {block.not_to_scale && <text x={right - 80} y={top - 11} className="not-scale">NOT TO SCALE</text>}
    </svg>
    {block.caption && <figcaption><MathText>{block.caption}</MathText></figcaption>}
  </figure>
}

export function StandardDiagramBlock({ block }) {
  if (validateStandardBlock({ ...block, type: 'diagram' }).length) return <div className="unsupported-block">Diagram data does not match the standard format. See validation warnings.</div>
  const [width, height] = block.view_box ?? []
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return <div className="unsupported-block">Diagram needs a positive view_box.</div>
  const viewport = Array.isArray(block.display_view_box) && block.display_view_box.length === 4 && block.display_view_box.every(finite) && block.display_view_box[2] > 0 && block.display_view_box[3] > 0
    ? block.display_view_box
    : [0, 0, width, height]
  return <figure className="diagram-block standard-diagram">
    <svg viewBox={viewport.join(' ')} role="img" aria-label={block.alt || 'Question diagram'}>
      {(block.elements ?? []).map((element, index) => <DrawingElement element={element} key={index} />)}
      {block.not_to_scale && <text x={width - 10} y={height - 8} textAnchor="end" className="not-scale">NOT TO SCALE</text>}
    </svg>
    {block.caption && <figcaption><MathText>{block.caption}</MathText></figcaption>}
  </figure>
}

export function StandardPatternSequenceBlock({ block }) {
  if (validateStandardBlock(block).length) return <div className="unsupported-block">Pattern data does not match the standard format. See validation warnings.</div>
  const displayViewBox = fitPatternViewBox(block)
  return <figure className="standard-pattern-sequence" aria-label={block.alt || 'Pattern sequence'}>
    <div className="standard-pattern-panels">{(block.patterns ?? []).map((pattern, index) => <div className={`standard-pattern-panel${pattern.elements?.length ? '' : ' is-blank'}`} key={pattern.label ?? index}>
      {pattern.elements?.length
        ? <StandardDiagramBlock block={{ type: 'diagram', view_box: pattern.view_box, display_view_box: displayViewBox, elements: pattern.elements, alt: pattern.alt || pattern.label || `Pattern ${index + 1}`, caption: pattern.caption, not_to_scale: pattern.not_to_scale }} />
        : <div className="pattern-blank-space" role="img" aria-label={`${pattern.label || `Pattern ${index + 1}`} is blank`} />}
      <strong>{pattern.label || `Pattern ${index + 1}`}</strong>
    </div>)}</div>
    {block.caption && <figcaption><MathText>{block.caption}</MathText></figcaption>}
  </figure>
}
