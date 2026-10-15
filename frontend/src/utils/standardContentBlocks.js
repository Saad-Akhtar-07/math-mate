// The imported paper data is curated. Keep structural checks close to the
// renderer so malformed visual records fail visibly instead of crashing it.
export function validateStandardBlock(block) {
  if (!block || typeof block !== 'object') return ['Missing block']
  if (block.type === 'diagram' && (!Array.isArray(block.view_box) || !Array.isArray(block.elements))) return ['Invalid diagram']
  if (block.type === 'graph') {
    const validRange = (range) => Array.isArray(range) && range.length === 2 && range.every((value) => typeof value === 'number' && Number.isFinite(value)) && range[1] > range[0]
    if (!validRange(block.x_axis?.range) || !validRange(block.y_axis?.range)) return ['Invalid graph axes']
    if (block.elements != null && !Array.isArray(block.elements)) return ['Invalid graph elements']
    if (block.elements?.some((element) => element.type === 'label' && (!Array.isArray(element.at) || element.at.length !== 2 || !element.at.every((value) => typeof value === 'number' && Number.isFinite(value))))) return ['Invalid graph label coordinates']
    if (block.elements?.some((element) => element.type === 'label' && element.offset != null && (!Array.isArray(element.offset) || element.offset.length !== 2 || !element.offset.every((value) => typeof value === 'number' && Number.isFinite(value))))) return ['Invalid graph label offset']
  }
  if (block.type === 'pattern_sequence' && !Array.isArray(block.patterns)) return ['Invalid pattern sequence']
  return []
}

// Pattern panels share a view box so successive stages keep the same scale.
// Widen an overly tight crop before it can hide a symbol at the edge.
export function fitPatternViewBox(block) {
  const validBox = (box) => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0
  const firstSize = block.patterns?.find((pattern) => Array.isArray(pattern.view_box))?.view_box
  const fallback = firstSize?.length === 2 && firstSize.every(Number.isFinite) && firstSize.every((value) => value > 0)
    ? [0, 0, ...firstSize]
    : null
  const box = validBox(block.display_view_box) ? block.display_view_box : fallback
  if (!box) return undefined

  let left = box[0]
  let top = box[1]
  let right = left + box[2]
  let bottom = top + box[3]
  const include = (x, y, halfWidth = 0, halfHeight = halfWidth) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    left = Math.min(left, x - halfWidth - 4)
    right = Math.max(right, x + halfWidth + 4)
    top = Math.min(top, y - halfHeight - 4)
    bottom = Math.max(bottom, y + halfHeight + 4)
  }

  for (const pattern of block.patterns || []) {
    for (const element of pattern.elements || []) {
      if (element.type === 'label' && Array.isArray(element.at)) {
        const [x, y] = element.at
        const width = Math.max(12, String(element.text || '').length * 8)
        const anchor = element.anchor || 'middle'
        const centerX = anchor === 'start' ? x + width / 2 : anchor === 'end' ? x - width / 2 : x
        include(centerX, y - 4.5, width / 2, 8.5)
      } else if (['circle', 'point'].includes(element.type) && Array.isArray(element.at)) {
        include(...element.at, (element.radius ?? (element.type === 'point' ? 3.5 : 9)) + (element.stroke_width ?? 2) / 2)
      } else if (['line', 'rect'].includes(element.type)) {
        if (Array.isArray(element.from)) include(...element.from, (element.stroke_width ?? 2) / 2)
        if (Array.isArray(element.to)) include(...element.to, (element.stroke_width ?? 2) / 2)
      } else if (Array.isArray(element.points)) {
        for (const point of element.points) if (Array.isArray(point)) include(...point, (element.stroke_width ?? 2) / 2)
      }
    }
  }

  const size = Math.max(right - left, bottom - top)
  return [left + (right - left - size) / 2, top + (bottom - top - size) / 2, size, size]
}
