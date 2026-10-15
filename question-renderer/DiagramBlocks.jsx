import MathText from './MathText'

const mathLabel = (value) => String(value ?? '').replaceAll('$', '').replaceAll('\\,', ' ').replaceAll('\\text{', '').replaceAll('}', '')

function axisRange(axis, fallbackMin, fallbackMax) {
  const range = Array.isArray(axis?.range) ? axis.range : []
  const min = Number(axis?.min ?? axis?.minimum ?? range[0] ?? fallbackMin)
  const max = Number(axis?.max ?? axis?.maximum ?? range[1] ?? fallbackMax)
  return Number.isFinite(min) && Number.isFinite(max) && max > min ? [min, max] : [fallbackMin, fallbackMax]
}

function scaleValues(min, max, step) {
  const safeStep = Number(step)
  if (!Number.isFinite(safeStep) || safeStep <= 0) return []
  const count = Math.min(500, Math.floor((max - min) / safeStep + 1e-8) + 1)
  return Array.from({ length: count }, (_, index) => Number((min + index * safeStep).toFixed(8)))
}

export function BeadPatternSequence({ block }) {
  return <figure className="bead-sequence" aria-label="Sequence of bead patterns">
    <div className="bead-patterns">
      {(block.patterns || []).map((pattern) => <div className="bead-pattern" key={pattern.number}>
        <div className="bead-rows">
          {(pattern.rows || []).map((row, rowIndex) => <div className="bead-row" key={rowIndex}>
            {Array.from({ length: Number(row.count) || 0 }, (_, beadIndex) => <span className={`bead ${row.bead === 'black' ? 'black' : 'white'}`} key={beadIndex} />)}
          </div>)}
        </div>
        <figcaption>Pattern {pattern.number}</figcaption>
      </div>)}
    </div>
    <div className="bead-legend"><span><i className="bead white" /> White bead</span><span><i className="bead black" /> Black bead</span></div>
  </figure>
}

export function DotCrossPatternSequence({ block }) {
  const patterns = Array.isArray(block.patterns) ? block.patterns : []
  return <figure className="dot-cross-sequence" aria-label="Dot cross pattern sequence">
    <div className="dot-cross-patterns">
      {patterns.map((pattern, index) => {
        const armLength = Math.max(0, Math.floor(Number(pattern.arm_length) || 0))
        const spacing = armLength ? Math.min(20, 46 / armLength) : 20
        const centre = 60
        const dots = [{ x: centre, y: centre }]
        for (let distance = 1; distance <= armLength; distance += 1) {
          dots.push(
            { x: centre - distance * spacing, y: centre },
            { x: centre + distance * spacing, y: centre },
            { x: centre, y: centre - distance * spacing },
            { x: centre, y: centre + distance * spacing },
          )
        }
        return <div className="dot-cross-pattern" key={pattern.pattern_number ?? index}>
          <svg viewBox="0 0 120 120" role="img" aria-label={`Pattern ${pattern.pattern_number ?? index + 1}, ${pattern.total_dots ?? dots.length} dots`}>
            {dots.map((dot, dotIndex) => <circle cx={dot.x} cy={dot.y} r="4.5" className="pattern-dot" key={dotIndex} />)}
          </svg>
          <strong>Pattern {pattern.pattern_number ?? index + 1}</strong>
        </div>
      })}
    </div>
    {block.description && <figcaption>{block.description}</figcaption>}
  </figure>
}

export function CoordinateGrid({ block }) {
  const xAxis = block.x_axis || { range: block.x_range || [-5, 5], major_step: block.major_step || 1, label: block.axes?.x_label }
  const yAxis = block.y_axis || { range: block.y_range || [-5, 5], major_step: block.major_step || 1, label: block.axes?.y_label }
  const [xMin, xMax] = axisRange(xAxis, -5, 5)
  const [yMin, yMax] = axisRange(yAxis, -5, 5)
  const xMajorTicks = Array.isArray(xAxis.major_ticks) ? xAxis.major_ticks.map(Number) : null
  const yMajorTicks = Array.isArray(yAxis.major_ticks) ? yAxis.major_ticks.map(Number) : null
  const xLabelStep = Number(xAxis.major_step ?? xAxis.labelled_interval ?? (xMajorTicks?.[1] - xMajorTicks?.[0])) || 1
  const yLabelStep = Number(yAxis.major_step ?? yAxis.labelled_interval ?? (yMajorTicks?.[1] - yMajorTicks?.[0])) || 1
  const showGrid = block.grid ?? block.fine_grid_present ?? true
  const fineGrid = showGrid && block.fine_grid_present !== false
  const xGridStep = Number(xAxis.minor_step ?? xAxis.grid_interval) || (fineGrid ? Math.min(1, xLabelStep) : xLabelStep)
  const yGridStep = Number(yAxis.minor_step ?? yAxis.grid_interval) || (fineGrid ? Math.min(1, yLabelStep) : yLabelStep)
  const left = 58; const right = 490; const top = 20; const bottom = 330
  const mapX = (value) => left + ((value - xMin) / (xMax - xMin)) * (right - left)
  const mapY = (value) => bottom - ((value - yMin) / (yMax - yMin)) * (bottom - top)
  const xValues = xMajorTicks || scaleValues(xMin, xMax, xLabelStep)
  const yValues = yMajorTicks || scaleValues(yMin, yMax, yLabelStep)
  const xGridValues = scaleValues(xMin, xMax, xGridStep)
  const yGridValues = scaleValues(yMin, yMax, yGridStep)
  const axisX = mapX(Math.max(xMin, Math.min(0, xMax)))
  const axisY = mapY(Math.max(yMin, Math.min(0, yMax)))
  const triangle = block.triangle_vertices && ['A', 'B', 'C'].map((label) => ({ label, point: block.triangle_vertices[label] }))
  const trianglePoints = triangle?.every(({ point }) => Array.isArray(point) && point.length === 2 && point.every((value) => Number.isFinite(Number(value))))
    ? triangle.map(({ point }) => `${mapX(Number(point[0]))},${mapY(Number(point[1]))}`).join(' ')
    : null
  return <figure className="diagram-block coordinate-grid-block">
    <svg viewBox="0 0 530 370" role="img" aria-label="Coordinate grid">
      {showGrid && xGridValues.map((value) => <line key={`xg${value}`} x1={mapX(value)} y1={top} x2={mapX(value)} y2={bottom} className="grid-line" />)}
      {showGrid && yGridValues.map((value) => <line key={`yg${value}`} x1={left} y1={mapY(value)} x2={right} y2={mapY(value)} className="grid-line" />)}
      {trianglePoints && <polygon points={trianglePoints} className="triangle-grid-region" />}
      <rect x={left} y={top} width={right - left} height={bottom - top} className="grid-border" />
      <line x1={left} y1={axisY} x2={right + 8} y2={axisY} className="axis-line" /><polyline points={`${right - 2},${axisY - 6} ${right + 8},${axisY} ${right - 2},${axisY + 6}`} className="axis-arrow" />
      <line x1={axisX} y1={bottom} x2={axisX} y2={top - 8} className="axis-line" /><polyline points={`${axisX - 6},${top + 2} ${axisX},${top - 8} ${axisX + 6},${top + 2}`} className="axis-arrow" />
      {(block.given_lines || []).map((line, index) => {
        const from = line.display_segment?.from
        const to = line.display_segment?.to
        return Array.isArray(from) && Array.isArray(to) && from.length === 2 && to.length === 2
          ? <line key={`given-${index}`} x1={mapX(Number(from[0]))} y1={mapY(Number(from[1]))} x2={mapX(Number(to[0]))} y2={mapY(Number(to[1]))} className="given-graph-line" />
          : null
      })}
      {trianglePoints && triangle.map(({ label, point }) => <text key={`vertex-${label}`} x={mapX(Number(point[0])) + (label === 'A' ? 8 : 7)} y={mapY(Number(point[1])) + (label === 'C' ? 16 : -8)} className="triangle-vertex-label">{label}</text>)}
      {xValues.map((value) => <g key={`xt${value}`}><line x1={mapX(value)} y1={axisY - 4} x2={mapX(value)} y2={axisY + 4} className="tick" />{value !== 0 && <text x={mapX(value)} y={axisY + 18} textAnchor="middle">{value}</text>}</g>)}
      {yValues.map((value) => <g key={`yt${value}`}><line x1={axisX - 4} y1={mapY(value)} x2={axisX + 4} y2={mapY(value)} className="tick" />{value !== 0 && <text x={axisX - 10} y={mapY(value) + 4} textAnchor="end">{value}</text>}</g>)}
      <text x={right + 15} y={axisY + 5}>{mathLabel(xAxis.label) || 'x'}</text><text x={axisX + 9} y={top - 5}>{mathLabel(yAxis.label) || 'y'}</text><text x={axisX - 10} y={axisY + 17}>O</text>
    </svg>
    <figcaption>Coordinate grid for plotting</figcaption>
    {Array.isArray(block.given_lines) && block.given_lines.length > 0 &&
      <div className="graph-inequalities">{block.given_lines.map((line, index) => <div key={index}><MathText>{line.equation}</MathText></div>)}</div>}
    {Array.isArray(block.inequalities) && block.inequalities.length > 0 &&
      <div className="graph-inequalities">{block.inequalities.map((inequality, index) => <div key={index}><MathText>{inequality}</MathText></div>)}</div>}
  </figure>
}

export function NumberLine({ block }) {
  const min = Number(block.shown_min ?? block.min ?? -5)
  const max = Number(block.shown_max ?? block.max ?? 5)
  const safeMin = Number.isFinite(min) ? min : -5
  const safeMax = Number.isFinite(max) && max > safeMin ? max : safeMin + 10
  const step = Number(block.labelled_interval ?? block.major_step) || 1
  const values = scaleValues(safeMin, safeMax, step)
  const boundary = Number(block.boundary?.value)
  const left = 45; const right = 485; const y = 70
  const mapX = (value) => left + ((value - safeMin) / (safeMax - safeMin)) * (right - left)
  const boundaryX = Number.isFinite(boundary) ? mapX(Math.max(safeMin, Math.min(boundary, safeMax))) : null
  const rayRight = block.ray_direction !== 'left'
  const rayEnd = rayRight ? right : left
  return <figure className="diagram-block number-line-block">
    <svg viewBox="0 0 530 125" role="img" aria-label="Number line">
      <line x1={left} y1={y} x2={right} y2={y} className="axis-line" />
      {values.map((value) => <g key={value}><line x1={mapX(value)} y1={y - 6} x2={mapX(value)} y2={y + 6} className="tick" /><text x={mapX(value)} y={y + 25} textAnchor="middle">{value}</text></g>)}
      {boundaryX !== null && <>
        <line x1={boundaryX} y1={y} x2={rayEnd} y2={y} className="number-line-ray" />
        <polyline points={rayRight ? `${right - 10},${y - 6} ${right},${y} ${right - 10},${y + 6}` : `${left + 10},${y - 6} ${left},${y} ${left + 10},${y + 6}`} className="number-line-ray" />
        <circle cx={boundaryX} cy={y} r="7" className={block.boundary?.endpoint === 'closed' ? 'number-line-endpoint closed' : 'number-line-endpoint'} />
      </>}
      <text x={right + 18} y={y + 5}>{mathLabel(block.variable) || 'x'}</text>
    </svg>
  </figure>
}

export function RectangleTriangleDiagram({ block }) {
  const rectangle = block.rectangle || {}
  const triangle = block.triangle || {}
  const sides = triangle.side_labels || []
  return <figure className="diagram-block rectangle-triangle-block">
    <svg viewBox="0 0 560 300" role="img" aria-label="Rectangle and triangle with labelled dimensions">
      <rect x="45" y="75" width="205" height="130" className="shape-line" />
      <text x="148" y="60" textAnchor="middle">{mathLabel(rectangle.length_label)}</text>
      {rectangle.width_label && <text x="28" y="143" textAnchor="middle" transform="rotate(-90 28 143)">{mathLabel(rectangle.width_label)}</text>}
      <text x="148" y="145" textAnchor="middle">{mathLabel(rectangle.area)}</text>
      <polygon points="330,205 500,205 390,55" className="shape-line" />
      <text x="351" y="126" textAnchor="middle" transform="rotate(-55 351 126)">{mathLabel(sides[0])}</text>
      <text x="455" y="125" textAnchor="middle" transform="rotate(54 455 125)">{mathLabel(sides[1])}</text>
      <text x="415" y="225" textAnchor="middle">{mathLabel(sides[2])}</text>
      {block.not_to_scale && <text x="425" y="280" className="not-scale">NOT TO SCALE</text>}
    </svg>
  </figure>
}

export function CompositeRectanglesDiagram({ block }) {
  const outer = block.outer_rectangle || {}
  const inner = block.inner_rectangle || {}
  const outerVertices = outer.vertices || ['E', 'F', 'G', 'D']
  const innerVertices = inner.vertices || ['A', 'B', 'C', 'D']
  const segment = (from, to) => (block.labelled_segments || []).find((item) => item.from === from && item.to === to)?.length
  return <figure className="diagram-block rectangles-block">
    <svg viewBox="0 0 540 340" role="img" aria-label="Composite rectangles diagram">
      <path d="M70 45 H465 V285 H70 Z M70 150 H300 V285 H70 Z" className="shaded-region" fillRule="evenodd" />
      <rect x="70" y="45" width="395" height="240" className="shape-line" />
      <rect x="70" y="150" width="230" height="135" className="inner-shape" />
      <text x="58" y="40">{outerVertices[0]}</text><text x="470" y="40">{outerVertices[1]}</text><text x="470" y="302">{outerVertices[2]}</text><text x="57" y="302">{outerVertices[3]}</text>
      <text x="57" y="148">{innerVertices[0]}</text><text x="304" y="148">{innerVertices[1]}</text><text x="304" y="302">{innerVertices[2]}</text>
      <text x="267" y="30" textAnchor="middle">{mathLabel(outer.top_length)}</text>
      <text x="486" y="170" textAnchor="middle" transform="rotate(90 486 170)">{mathLabel(outer.right_length)}</text>
      <text x="50" y="100" textAnchor="middle" transform="rotate(-90 50 100)">{mathLabel(segment('E', 'A'))}</text>
      <text x="382" y="307" textAnchor="middle">{mathLabel(segment('C', 'G'))}</text>
      <line x1="65" y1="45" x2="75" y2="45" className="dimension-tick" /><line x1="65" y1="150" x2="75" y2="150" className="dimension-tick" />
      <line x1="300" y1="280" x2="300" y2="290" className="dimension-tick" /><line x1="465" y1="280" x2="465" y2="290" className="dimension-tick" />
      {block.not_to_scale && <text x="380" y="330" className="not-scale">NOT TO SCALE</text>}
    </svg>
    <figcaption>{block.shading ? 'Shaded region: outer rectangle excluding inner rectangle' : 'Composite rectangles'}</figcaption>
  </figure>
}

function cleanMath(value) {
  return String(value || '').replaceAll('$', '').replaceAll('\\text{', '').replaceAll('}', '').replaceAll('\\,', ' ').trim()
}

export function CuboidDimensionDiagram({ block }) {
  const length = cleanMath(block.length).replace(/\s*cm$/i, '') || 'x'
  const heightRelationship = block.relationships?.height || ''
  const widthRelationship = block.relationships?.width || ''
  const heightTimes = heightRelationship.match(/([\d.]+)\s+times/i)?.[1]
  const widthLess = widthRelationship.match(/([\d.]+)\s*cm\s+less/i)?.[1]
  const heightLabel = heightTimes ? `${heightTimes}${length}` : heightRelationship
  const widthLabel = widthLess ? `${length} − ${widthLess}` : widthRelationship
  return <figure className="diagram-block cuboid-block">
    <svg viewBox="0 0 560 340" role="img" aria-label="Cuboid with labelled dimensions">
      <polygon points="105,105 390,105 390,270 105,270" className="cuboid-front" />
      <polygon points="105,105 170,55 455,55 390,105" className="cuboid-top" />
      <polygon points="390,105 455,55 455,220 390,270" className="cuboid-side" />
      <line x1="105" y1="270" x2="170" y2="220" className="hidden-edge" />
      <line x1="170" y1="220" x2="455" y2="220" className="hidden-edge" />
      <line x1="170" y1="55" x2="170" y2="220" className="hidden-edge" />
      <text x="247" y="298" textAnchor="middle">{length} cm</text>
      <text x="78" y="190" textAnchor="middle" transform="rotate(-90 78 190)">{heightLabel} cm</text>
      <text x="432" y="260" textAnchor="middle" transform="rotate(-38 432 260)">{widthLabel} cm</text>
      {block.not_to_scale && <text x="420" y="325" className="not-scale">NOT TO SCALE</text>}
    </svg>
    <figcaption>Length {cleanMath(block.length)} · Height {heightRelationship} · Width {widthRelationship}</figcaption>
  </figure>
}

function equationFunction(equation) {
  let rhs = cleanMath(equation).split('=')[1]?.replaceAll(' ', '') || '0'
  const fraction = rhs.match(/^\\dfrac\{?(−?-?\d+)\}?\{?(\d+)\}?x$/)
  if (fraction) return (x) => Number(fraction[1].replace('−', '-')) / Number(fraction[2]) * x
  if (/^−?\-?x$/.test(rhs)) return (x) => -x
  const constantMinusX = rhs.match(/^(−?-?[\d.]+)-x$/)
  if (constantMinusX) return (x) => Number(constantMinusX[1].replace('−', '-')) - x
  const xPlusConstant = rhs.match(/^x([+-][\d.]+)$/)
  if (xPlusConstant) return (x) => x + Number(xPlusConstant[1])
  if (/^x$/.test(rhs)) return (x) => x
  const coefficient = rhs.match(/^(−?-?[\d.]+)x(?:([+-][\d.]+))?$/)
  if (coefficient) return (x) => Number(coefficient[1].replace('−', '-')) * x + Number(coefficient[2] || 0)
  const constant = Number(rhs.replace('−', '-'))
  return () => Number.isFinite(constant) ? constant : 0
}

export function InequalityRegionGraph({ block }) {
  const xRange = block.x_axis?.range || [-5, 5]
  const yRange = block.y_axis?.range || [-5, 5]
  const [xMin, xMax] = xRange.map(Number); const [yMin, yMax] = yRange.map(Number)
  const left = 54; const right = 486; const top = 20; const bottom = 365
  const mapX = (value) => left + ((value - xMin) / (xMax - xMin)) * (right - left)
  const mapY = (value) => bottom - ((value - yMin) / (yMax - yMin)) * (bottom - top)
  const boundaries = (block.boundary_lines || []).map((line) => ({ ...line, fn: equationFunction(line.equation) }))
  const upper = boundaries.find((line) => line.style === 'dashed')
  const lowers = boundaries.filter((line) => line !== upper)
  const samples = Array.from({ length: 161 }, (_, index) => xMin + index / 160 * (xMax - xMin))
  const valid = samples.map((x) => ({ x, low: Math.max(...lowers.map((line) => line.fn(x))), high: upper ? upper.fn(x) : yMax })).filter((point) => point.low <= point.high && point.high >= yMin && point.low <= yMax)
  const regionPoints = valid.length ? [...valid.map((point) => `${mapX(point.x)},${mapY(Math.min(yMax, point.high))}`), ...valid.slice().reverse().map((point) => `${mapX(point.x)},${mapY(Math.max(yMin, point.low))}`)].join(' ') : ''
  const xValues = []; const yValues = []
  for (let value = xMin; value <= xMax; value += Number(block.x_axis?.major_step) || 1) xValues.push(value)
  for (let value = yMin; value <= yMax; value += Number(block.y_axis?.major_step) || 1) yValues.push(value)
  const axisX = mapX(Math.max(xMin, Math.min(0, xMax))); const axisY = mapY(Math.max(yMin, Math.min(0, yMax)))
  return <figure className="diagram-block inequality-graph-block">
    <svg viewBox="0 0 540 405" role="img" aria-label="Graph showing a region defined by inequalities">
      <defs><clipPath id="inequality-plot"><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath></defs>
      <rect x={left} y={top} width={right - left} height={bottom - top} className="excluded-region" />
      {regionPoints && <polygon points={regionPoints} className="target-region" clipPath="url(#inequality-plot)" />}
      {xValues.map((value) => <line key={`x${value}`} x1={mapX(value)} y1={top} x2={mapX(value)} y2={bottom} className="grid-line" />)}
      {yValues.map((value) => <line key={`y${value}`} x1={left} y1={mapY(value)} x2={right} y2={mapY(value)} className="grid-line" />)}
      <line x1={left} y1={axisY} x2={right} y2={axisY} className="axis-line" /><line x1={axisX} y1={top} x2={axisX} y2={bottom} className="axis-line" />
      {boundaries.map((line, index) => <line key={index} x1={mapX(xMin)} y1={mapY(line.fn(xMin))} x2={mapX(xMax)} y2={mapY(line.fn(xMax))} className={`boundary-line ${line.style === 'dashed' ? 'dashed' : ''}`} clipPath="url(#inequality-plot)" />)}
      {xValues.map((value) => value !== 0 && <text key={`xt${value}`} x={mapX(value)} y={axisY + 17} textAnchor="middle">{value}</text>)}
      {yValues.map((value) => value !== 0 && <text key={`yt${value}`} x={axisX - 9} y={mapY(value) + 4} textAnchor="end">{value}</text>)}
      <text x={right + 8} y={axisY + 5}>x</text><text x={axisX + 8} y={top + 4}>y</text>
      {valid.length > 0 && <text x={mapX(valid[Math.floor(valid.length / 2)].x)} y={mapY((valid[Math.floor(valid.length / 2)].low + valid[Math.floor(valid.length / 2)].high) / 2)} className="region-label">{block.target_region_label || 'R'}</text>}
    </svg>
    <figcaption>{cleanMath(block.target_region_description)}</figcaption>
  </figure>
}
