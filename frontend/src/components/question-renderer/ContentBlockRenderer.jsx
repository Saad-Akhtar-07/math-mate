import MathText from './MathText'
import { BeadPatternSequence, CompositeRectanglesDiagram, CoordinateGrid, CuboidDimensionDiagram, DotCrossPatternSequence, InequalityRegionGraph, NumberLine, RectangleTriangleDiagram } from './DiagramBlocks'
import GenericStructuredBlock from './GenericStructuredBlock'
import DistanceTimeGraphBlock from './DistanceTimeGraphBlock'
import FunctionGraphBlock from './FunctionGraphBlock'
import QuadraticGraphSketchBlock from './QuadraticGraphSketchBlock'
import PracticalLineGraphBlock from './PracticalLineGraphBlock'
import TriangularPatternSequenceBlock from './TriangularPatternSequenceBlock'
import CrossCirclePatternSequenceBlock from './CrossCirclePatternSequenceBlock'
import { StandardDiagramBlock, StandardGraphBlock, StandardPatternSequenceBlock } from './StandardVisualBlocks'

function ParagraphBlock({ block }) {
  return <p className="question-paragraph"><MathText>{block.content}</MathText></p>
}

function FormulaBlock({ block }) {
  const content = String(block.content || '').trim()
  const wrapped = content.match(/^(\$\$|\$)([\s\S]*?)\1([.,;:!?]*)$/)
  const rendered = wrapped ? `$$${wrapped[2]}$$${wrapped[3]}` : content.includes('$') ? content : `$$${content}$$`
  return <div className="formula-block"><MathText>{rendered}</MathText></div>
}

function TableBlock({ block }) {
  const rows = Array.isArray(block.rows) ? block.rows : []
  return (
    <div className="table-scroll">
      <table className="exam-table"><tbody>
        {rows.map((row, rowIndex) => <tr key={rowIndex}>{(Array.isArray(row) ? row : [row]).map((cell, cellIndex) => <td key={cellIndex} className={cell === null ? 'blank-cell' : ''}><MathText>{cell === null || cell === undefined ? '' : typeof cell === 'object' ? JSON.stringify(cell) : cell}</MathText></td>)}</tr>)}
      </tbody></table>
    </div>
  )
}

function ImageBlock({ block }) {
  if (!block.src) return <div className="unsupported-block">Image block has no source</div>
  return <figure className="image-block"><img src={block.src} alt={block.alt || 'Question diagram'} /><figcaption>{block.caption}</figcaption></figure>
}

function CoordinateAxesBlock({ block }) {
  return <figure className="diagram-block">
    <svg viewBox="0 0 520 270" role="img" aria-label="Coordinate axes for sketch response">
      {block.grid && Array.from({ length: 17 }, (_, i) => <line key={`v${i}`} x1={40 + i * 28} y1="18" x2={40 + i * 28} y2="242" className="grid-line" />)}
      {block.grid && Array.from({ length: 9 }, (_, i) => <line key={`h${i}`} x1="40" y1={18 + i * 28} x2="488" y2={18 + i * 28} className="grid-line" />)}
      <line x1="40" y1="130" x2="493" y2="130" className="axis-line" /><polyline points="483,124 493,130 483,136" className="axis-arrow" />
      <line x1="264" y1="242" x2="264" y2="13" className="axis-line" /><polyline points="258,23 264,13 270,23" className="axis-arrow" />
      <text x="498" y="135">{String(block.x_label || block.x_axis_label || 'x').replaceAll('$', '')}</text><text x="272" y="18">{String(block.y_label || block.y_axis_label || 'y').replaceAll('$', '')}</text><text x="250" y="146">{String(block.origin_label || 'O').replaceAll('$', '')}</text>
    </svg>
    <figcaption>Sketch response area</figcaption>
  </figure>
}

function SpeedTimeGraphBlock({ block }) {
  const normalisePoint = (point) => Array.isArray(point)
    ? { t: point[0], speed: point[1] }
    : { t: point?.t ?? point?.time ?? point?.x, speed: point?.speed ?? point?.y }
  const points = block.polyline_vertices?.map(normalisePoint) || block.polyline_points?.map(normalisePoint) || (block.segments || []).flatMap((segment, index) => index ? [normalisePoint(segment.to)] : [normalisePoint(segment.from), normalisePoint(segment.to)])
  const times = points.map((point) => typeof point.t === 'number' ? point.t : null).filter((value) => value !== null)
  const markedTimes = (block.x_axis?.marked_values || block.x_axis?.shown_values || block.x_axis?.key_values || []).filter((value) => typeof value === 'number')
  const maxTime = Math.max(...times, ...markedTimes, 1)
  const numericSpeeds = [...points.map((point) => point.speed), ...(block.y_axis?.marked_values || block.y_axis?.shown_values || block.y_axis?.key_values || [])].filter((value) => typeof value === 'number' && value > 0)
  const hasSymbolicSpeed = points.some((point) => typeof point.speed !== 'number' && point.speed !== 0)
  const maxNumericSpeed = Math.max(...numericSpeeds, 1)
  const x = (value) => 55 + (typeof value === 'number' ? value / maxTime : 1) * 410
  const y = (value) => {
    if (value === 0) return 225
    if (typeof value !== 'number') return 65
    return hasSymbolicSpeed ? 175 - (value / maxNumericSpeed) * 55 : 225 - (value / maxNumericSpeed) * 160
  }
  const xMarks = [...new Set(block.x_axis?.marked_values || block.x_axis?.shown_values || block.x_axis?.key_values || points.map((point) => point.t))]
  const yMarks = [...new Set(block.y_axis?.marked_values || block.y_axis?.shown_values || block.y_axis?.key_values || points.map((point) => point.speed))]
  const guideLines = (block.guide_lines || []).map((line) => ({
    ...line,
    from: normalisePoint(line.from || (line.orientation === 'vertical' ? { t: line.x, speed: line.from_y } : { t: line.from_x, speed: line.y })),
    to: normalisePoint(line.to || (line.orientation === 'vertical' ? { t: line.x, speed: line.to_y } : { t: line.to_x, speed: line.y })),
  }))
  return <figure className="diagram-block speed-graph">
    <svg viewBox="0 0 520 280" role="img" aria-label="Speed-time graph">
      <line x1="55" y1="225" x2="480" y2="225" className="axis-line" /><polyline points="470,219 480,225 470,231" className="axis-arrow" />
      <line x1="55" y1="225" x2="55" y2="30" className="axis-line" /><polyline points="49,40 55,30 61,40" className="axis-arrow" />
      {guideLines.map((line, index) => <line key={`guide-${index}`} x1={x(line.from.t)} y1={y(line.from.speed)} x2={x(line.to.t)} y2={y(line.to.speed)} className={`guide-line ${line.style === 'dashed' ? 'dashed' : ''}`} />)}
      {points.slice(1).map((point, index) => <line key={index} x1={x(points[index].t)} y1={y(points[index].speed)} x2={x(point.t)} y2={y(point.speed)} className="graph-segment" />)}
      {xMarks.map((value, index) => <g key={index}><line x1={x(value)} y1="225" x2={x(value)} y2="232" className="tick" /><text x={x(value)} y="248" textAnchor="middle">{String(value)}</text></g>)}
      {yMarks.filter((value) => value !== 0).map((value, index) => <g key={index}><line x1="50" y1={y(value)} x2="60" y2={y(value)} className="tick" /><text x="43" y={y(value) + 4} textAnchor="end">{String(value)}</text></g>)}
      <text x="488" y="231">t</text><text x="12" y="25">{block.y_axis?.label || 'Speed'}</text>
      {block.not_to_scale && <text x="390" y="24" className="not-scale">NOT TO SCALE</text>}
    </svg>
    <figcaption>{block.x_axis?.label || 'Time'}{block.x_axis?.unit ? ` (${block.x_axis.unit})` : ''}</figcaption>
  </figure>
}

export default function ContentBlockRenderer({ block }) {
  if (!block || typeof block !== 'object') return <div className="unsupported-block">Malformed content block</div>
  switch (block.type) {
    case 'paragraph':
    case 'instruction': return <ParagraphBlock block={block} />
    case 'formula':
    case 'equation': return <FormulaBlock block={block} />
    case 'table': return <TableBlock block={block} />
    case 'graph': return <StandardGraphBlock block={block} />
    case 'diagram': return <StandardDiagramBlock block={block} />
    case 'pattern_sequence': return <StandardPatternSequenceBlock block={block} />
    case 'equation_system': return <GenericStructuredBlock block={block} />
    case 'sequence': return <p className="question-paragraph"><MathText>{(block.values || []).join(', ')}</MathText></p>
    case 'inequality_set': return <div className="inequality-set">{(block.inequalities || []).map((inequality, index) => <div key={index}><MathText>{inequality}</MathText></div>)}</div>
    case 'image': return <ImageBlock block={block} />
    case 'coordinate_axes': return <CoordinateAxesBlock block={block} />
    case 'speed_time_graph': return <SpeedTimeGraphBlock block={block} />
    case 'distance_time_graph': return <DistanceTimeGraphBlock block={block} />
    case 'function_graph': return <FunctionGraphBlock block={block} />
    case 'quadratic_graph_sketch': return <QuadraticGraphSketchBlock block={block} />
    case 'practical_line_graph': return <PracticalLineGraphBlock block={block} />
    case 'triangular_pattern_sequence': return <TriangularPatternSequenceBlock block={block} />
    case 'cross_circle_pattern_sequence': return <CrossCirclePatternSequenceBlock block={block} />
    case 'bead_pattern_sequence': return <BeadPatternSequence block={block} />
    case 'dot_cross_pattern_sequence': return <DotCrossPatternSequence block={block} />
    case 'coordinate_grid': return <CoordinateGrid block={block} />
    case 'number_line': return <NumberLine block={block} />
    case 'composite_rectangles_diagram': return <CompositeRectanglesDiagram block={block} />
    case 'rectangle_triangle_diagram': return <RectangleTriangleDiagram block={block} />
    case 'cuboid_dimension_diagram': return <CuboidDimensionDiagram block={block} />
    case 'inequality_region_graph': return <InequalityRegionGraph block={block} />
    case 'part_reference': return <p className="part-reference"><MathText>{block.content || `Use ${block.target_part_id || 'the referenced part'}.`}</MathText></p>
    case 'shared_graph_reference': return <p className="part-reference"><MathText>{block.note || `Use the graph from ${block.ref}.`}</MathText></p>
    case 'shared_content_reference': return <p className="part-reference"><MathText>{block.note || 'Use the diagrams shown above.'}</MathText></p>
    default:
      if (Array.isArray(block.rows)) return <TableBlock block={block} />
      if (block.src || block.url) return <ImageBlock block={{ ...block, src: block.src || block.url }} />
      if (block.x_axis && block.y_axis) return <CoordinateGrid block={block} />
      return <GenericStructuredBlock block={block} />
  }
}
