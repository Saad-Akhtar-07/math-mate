// Keep graph annotations readable when a label is placed on a plotted line.
// Coordinates are SVG pixels, so the spacing stays consistent across graph scales.
const TEXT_HEIGHT = 13
const LABEL_GAP = 10

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  const fraction = lengthSquared
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared))
    : 0
  return Math.hypot(point[0] - start[0] - fraction * dx, point[1] - start[1] - fraction * dy)
}

function segmentsFor(elements, map, domain) {
  return elements.flatMap((element) => {
    if (element.type === 'line') return [[map(element.from), map(element.to)]]
    if (element.type === 'point') {
      const point = map(element.at)
      return [[point, point]]
    }
    let points = element.points
    if (element.type === 'polynomial') {
      const [min, max] = element.domain || domain || []
      if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
        points = Array.from({ length: 81 }, (_, index) => {
          const x = min + (max - min) * index / 80
          return [x, element.coefficients.reduce((sum, coefficient) => sum * x + coefficient, 0)]
        })
      }
    }
    if (!['polyline', 'polygon', 'curve', 'polynomial'].includes(element.type) || !Array.isArray(points)) return []
    const mapped = points.map(map)
    const pairs = mapped.slice(1).map((point, index) => [mapped[index], point])
    if (element.type === 'polygon' && mapped.length > 2) pairs.push([mapped.at(-1), mapped[0]])
    return pairs
  })
}

function boundsFor(label, x, y, anchor) {
  const width = Math.max(8, String(label).length * 7.2)
  const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x
  return { left, right: left + width, top: y - TEXT_HEIGHT, bottom: y + 3 }
}

function inside(point, bounds) {
  return point[0] >= bounds.left && point[0] <= bounds.right && point[1] >= bounds.top && point[1] <= bounds.bottom
}

function intersects(segment, bounds) {
  const [start, end] = segment
  if (inside(start, bounds) || inside(end, bounds)) return true
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  let low = 0
  let high = 1
  for (const [p, q] of [[-dx, start[0] - bounds.left], [dx, bounds.right - start[0]], [-dy, start[1] - bounds.top], [dy, bounds.bottom - start[1]]]) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const ratio = q / p
      if (p < 0) low = Math.max(low, ratio)
      else high = Math.min(high, ratio)
      if (low > high) return false
    }
  }
  return true
}

function overlaps(first, second) {
  return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
}

export function layoutGraphLabels(elements, map, viewport = { width: 560, height: 365, plotBottom: 310 }) {
  const segments = segmentsFor(elements, map, viewport.domain)
  const occupied = []
  const placements = new Map()
  for (const element of elements.filter((item) => item.type === 'label')) {
    const point = map(element.at)
    const preferredAnchor = element.anchor || 'middle'
    if (element.offset) {
      const placement = { x: point[0] + element.offset[0], y: point[1] + element.offset[1], anchor: preferredAnchor }
      placements.set(element, placement)
      occupied.push(boundsFor(element.text, placement.x, placement.y, placement.anchor))
      continue
    }
    const onPlot = segments.some((segment) => distanceToSegment(point, ...segment) <= 5)
    if (!onPlot) {
      const placement = { x: point[0], y: point[1], anchor: preferredAnchor }
      placements.set(element, placement)
      occupied.push(boundsFor(element.text, placement.x, placement.y, placement.anchor))
      continue
    }
    const candidates = [
      { x: point[0] - LABEL_GAP, y: point[1] - 12, anchor: 'end' },
      { x: point[0] + LABEL_GAP, y: point[1] - 12, anchor: 'start' },
      { x: point[0] - LABEL_GAP, y: point[1] + 19, anchor: 'end' },
      { x: point[0] + LABEL_GAP, y: point[1] + 19, anchor: 'start' },
    ]
    const scored = candidates.map((placement, index) => {
      const bounds = boundsFor(element.text, placement.x, placement.y, placement.anchor)
      const padded = { left: bounds.left - 2, right: bounds.right + 2, top: bounds.top - 2, bottom: bounds.bottom + 2 }
      const outside = bounds.left < 5 || bounds.right > viewport.width - 5 || bounds.top < 5 || bounds.bottom > viewport.height - 5
      const lineHits = segments.filter((segment) => intersects(segment, padded)).length
      const labelHits = occupied.filter((previous) => overlaps(previous, padded)).length
      const tickArea = bounds.top > viewport.plotBottom + 3
      return { placement, bounds, score: (outside ? 1000 : 0) + 100 * lineHits + 100 * labelHits + (tickArea ? 20 : 0) + (placement.anchor === preferredAnchor ? 0 : 1) + index * .01 }
    })
    scored.sort((left, right) => left.score - right.score)
    placements.set(element, scored[0].placement)
    occupied.push(scored[0].bounds)
  }
  return placements
}
