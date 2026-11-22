import { Circle, MapPin, Minus, PaintBucket, Pencil, Tag, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StandardDiagramBlock, StandardGraphBlock } from '../question-renderer/StandardVisualBlocks.jsx'

const GRAPH_BOX = { left: 70, right: 510, top: 30, bottom: 310 }
const ink = '#1664c0'

const tools = [
  { id: 'pen', label: 'Draw', Icon: Pencil },
  { id: 'line', label: 'Line', Icon: Minus },
  { id: 'point', label: 'Point', Icon: MapPin },
  { id: 'circle', label: 'Circle', Icon: Circle },
  { id: 'shade', label: 'Shade', Icon: PaintBucket },
  { id: 'label', label: 'Label', Icon: Tag },
]

function blank(source = 'canvas') {
  return { version: 'visual-answer-v1', primary_source: source, objects: [] }
}

function viewport(block) {
  if (block.type === 'graph') return [0, 0, 560, 365]
  const value = block.display_view_box || block.view_box || [0, 0, 560, 365]
  return value.length === 2 ? [0, 0, ...value] : value
}

function screenPoint(svg, event, box) {
  const bounds = svg.getBoundingClientRect()
  return [
    box[0] + (event.clientX - bounds.left) * box[2] / bounds.width,
    box[1] + (event.clientY - bounds.top) * box[3] / bounds.height,
  ]
}

function graphPoint(block, [x, y]) {
  const [xMin, xMax] = block.x_axis.range
  const [yMin, yMax] = block.y_axis.range
  return [
    xMin + (x - GRAPH_BOX.left) * (xMax - xMin) / (GRAPH_BOX.right - GRAPH_BOX.left),
    yMin + (GRAPH_BOX.bottom - y) * (yMax - yMin) / (GRAPH_BOX.bottom - GRAPH_BOX.top),
  ].map((value) => Number(value.toFixed(4)))
}

function distance([x1, y1], [x2, y2]) {
  return Math.hypot(x2 - x1, y2 - y1)
}

function exportSvg(svg) {
  if (!svg) return Promise.resolve(null)
  const clone = svg.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = `
    svg{--diagram-ink:#1a1c29;--diagram-muted:#747887;--diagram-grid:#cfd3dc;--diagram-paper:#fff;--accent:#315bd6;background:#fff}
    text{fill:#1a1c29;font:12px Arial,sans-serif}.standard-graph-grid line{stroke:#cfd3dc;stroke-width:1}.standard-minor-grid{opacity:.45}
    .standard-graph-border{stroke:#cfd3dc;fill:none}.standard-graph-axes line{stroke:#1a1c29;stroke-width:1.6}.student-visual-overlay>*{stroke-linecap:round;stroke-linejoin:round}
  `
  clone.insertBefore(style, clone.firstChild)
  const box = svg.viewBox.baseVal
  const width = 1120
  const height = Math.max(240, Math.round(width * box.height / box.width))
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  const source = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(source)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, width, height)
      context.drawImage(image, 0, 0, width, height)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare the drawing image.')), 'image/jpeg', 0.9)
    }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not prepare the drawing image.')) }
    image.src = url
  })
}

export default function VisualResponseEditor({ block, value, ready, uploadsEnabled, onChange, onPickPhoto, photoReady, registerExporter }) {
  const answer = value?.version === 'visual-answer-v1' ? value : blank()
  const [tool, setTool] = useState('pen')
  const [draft, setDraft] = useState(null)
  const svgRef = useRef(null)
  const drawing = useRef(null)
  const box = useMemo(() => viewport(block), [block])
  const markSize = block.type === 'graph' ? 3 : Math.max(box[2], box[3]) / 180
  const pointRadius = block.type === 'graph' ? 4 : Math.max(box[2], box[3]) / 150
  const canvasMode = answer.primary_source !== 'photo'

  useEffect(() => {
    registerExporter?.(() => exportSvg(svgRef.current))
    return () => registerExporter?.(null)
  }, [registerExporter])

  const update = (objects, source = answer.primary_source) => onChange({
    version: 'visual-answer-v1', primary_source: source, objects: objects.slice(0, 120),
    canvas: { block_type: block.type },
  })
  const storedPoint = (event) => {
    const point = screenPoint(svgRef.current, event, box)
    return block.type === 'graph' ? graphPoint(block, point) : point.map((item) => Number(item.toFixed(2)))
  }
  const pointerDown = (event) => {
    if (!ready || !canvasMode) return
    event.preventDefault()
    const at = storedPoint(event)
    const screen = screenPoint(svgRef.current, event, box)
    if (tool === 'point') {
      update([...answer.objects, { id: crypto.randomUUID(), type: 'point', at, radius: pointRadius, stroke: ink, fill: ink }])
      return
    }
    if (tool === 'label') {
      const text = window.prompt('Label to place here')?.trim().slice(0, 40)
      if (text) update([...answer.objects, { id: crypto.randomUUID(), type: 'label', at, text, fill: ink }])
      return
    }
    svgRef.current.setPointerCapture?.(event.pointerId)
    drawing.current = { start: at, screenStart: screen, points: [at], object: null }
  }
  const pointerMove = (event) => {
    if (!drawing.current) return
    const at = storedPoint(event)
    const { start, screenStart } = drawing.current
    if (tool === 'pen' || tool === 'shade') drawing.current.points.push(at)
    const object = tool === 'line'
      ? { type: 'line', from: start, to: at, stroke: ink, stroke_width: markSize }
      : tool === 'circle'
        ? { type: 'circle', at: start, radius: Math.max(markSize, distance(screenPoint(svgRef.current, event, box), screenStart)), stroke: ink, stroke_width: markSize, fill: 'none' }
        : { type: tool === 'shade' ? 'polygon' : 'curve', points: drawing.current.points, stroke: ink, stroke_width: markSize,
            fill: tool === 'shade' ? 'rgba(22,100,192,.22)' : 'none' }
    drawing.current.object = object
    setDraft(object)
  }
  const pointerUp = () => {
    if (!drawing.current) return
    const object = drawing.current.object
    drawing.current = null
    if (object) update([...answer.objects, { ...object, id: crypto.randomUUID() }])
    setDraft(null)
  }
  const selectSource = (source) => {
    if (!ready || source === answer.primary_source) return
    update(answer.objects, source)
  }
  const pickPhoto = (files) => {
    update([], 'photo')
    onPickPhoto(files)
  }
  const overlay = draft ? [...answer.objects, draft] : answer.objects
  const Visual = block.type === 'graph' ? StandardGraphBlock : StandardDiagramBlock

  return <div className="ws-visual-answer">
    <div className="ws-visual-choice" role="group" aria-label="Visual answer method">
      <button type="button" className={canvasMode ? 'is-selected' : ''} aria-pressed={canvasMode} disabled={!ready} onClick={() => selectSource('canvas')}>Draw here</button>
      <button type="button" className={!canvasMode ? 'is-selected' : ''} aria-pressed={!canvasMode} disabled={!ready} onClick={() => selectSource('photo')}>Use a photo</button>
    </div>
    {canvasMode ? <>
      <div className="ws-drawing-tools" role="toolbar" aria-label="Drawing tools">
        {tools.map(({ id, label, Icon }) => <button type="button" key={id} title={label} aria-label={label} aria-pressed={tool === id}
          className={tool === id ? 'is-selected' : ''} disabled={!ready} onClick={() => setTool(id)}><Icon size={17} /><span>{label}</span></button>)}
        <span className="ws-tool-spacer" />
        <button type="button" title="Undo" aria-label="Undo last mark" disabled={!ready || !answer.objects.length} onClick={() => update(answer.objects.slice(0, -1))}><Undo2 size={17} /></button>
        <button type="button" title="Clear" aria-label="Clear drawing" disabled={!ready || !answer.objects.length} onClick={() => update([])}><Trash2 size={17} /></button>
      </div>
      <div className="ws-drawing-surface" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
        <Visual block={block} overlayElements={overlay} svgRef={svgRef} interactive />
      </div>
      <p className="ws-visual-help">Draw directly on the question. Your drawing is saved automatically.</p>
    </> : <div className="ws-photo-primary">
      <p>{photoReady ? 'Your visual answer photo is ready.' : 'Upload one clear photo showing the complete graph or diagram.'}</p>
      <label className="ws-photo-button is-primary">
        {photoReady ? 'Replace photo' : 'Choose photo'}
        <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={!ready || !uploadsEnabled} onChange={(event) => {
          const files = Array.from(event.target.files || []).slice(0, 1)
          if (files.length) pickPhoto(files)
          event.target.value = ''
        }} />
      </label>
    </div>}
  </div>
}
