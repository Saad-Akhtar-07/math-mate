import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Drag handle on the tutor column's left edge (an ARIA window splitter).
// It sets --tutor-width on its parent (the workspace body), so dragging re-renders only this handle.
const STORAGE_KEY = 'practice-tutor-width-v1'
export const TUTOR_MIN_WIDTH = 380
export const TUTOR_MAX_WIDTH = 760
const QUESTION_MIN_WIDTH = 560
const DEFAULT_SHARE = 0.44
const DEFAULT_MAX = 540
const STEP = 24
const BIG_STEP = 64

function storedWidth() {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch { return null }
}

function saveWidth(value) {
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, String(value))
  } catch { /* The size still applies on this page. */ }
}

// The widest the tutor may be leaves the question column at least QUESTION_MIN_WIDTH.
function measure(body) {
  const rect = body?.getBoundingClientRect()
  const total = rect?.width || window.innerWidth
  return { total, right: rect?.right || total, min: TUTOR_MIN_WIDTH, max: Math.max(TUTOR_MIN_WIDTH, Math.min(TUTOR_MAX_WIDTH, total - QUESTION_MIN_WIDTH)) }
}

const clamp = (value, bounds) => Math.round(Math.min(bounds.max, Math.max(bounds.min, value)))

export default function TutorResizer() {
  // The handle's own parent is the body. A ref passed down from the page would still be
  // empty here, because React runs a child's layout effects before attaching the parent's ref.
  const handleRef = useRef(null)
  const body = () => handleRef.current?.parentElement
  const [width, setWidth] = useState(storedWidth) // null: the default size from CSS
  const [bounds, setBounds] = useState(() => measure(null))
  const [dragging, setDragging] = useState(false)
  const frame = useRef(null)
  const current = clamp(width ?? Math.min(bounds.total * DEFAULT_SHARE, DEFAULT_MAX), bounds)

  // Keep the limits in step with the window.
  useLayoutEffect(() => {
    const update = () => setBounds(measure(body()))
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (observer && body()) observer.observe(body())
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [])

  useLayoutEffect(() => {
    const element = body()
    if (!element) return undefined
    if (width === null) element.style.removeProperty('--tutor-width')
    else element.style.setProperty('--tutor-width', `${current}px`)
    return () => element.style.removeProperty('--tutor-width')
  }, [width, current])

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    document.documentElement.classList.remove('is-resizing-tutor')
  }, [])

  const choose = (value) => {
    const next = value === null ? null : clamp(value, measure(body()))
    setWidth(next)
    saveWidth(next)
  }
  // At most one update per frame, using the latest pointer position.
  const pointerX = useRef(0)
  const follow = (clientX) => {
    pointerX.current = clientX
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const latest = measure(body())
      setWidth(clamp(latest.right - pointerX.current, latest))
    })
  }

  const onPointerDown = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    document.documentElement.classList.add('is-resizing-tutor')
    setDragging(true)
    follow(event.clientX)
  }
  const onPointerMove = (event) => { if (dragging) follow(event.clientX) }
  const finish = (event) => {
    if (!dragging) return
    setDragging(false)
    document.documentElement.classList.remove('is-resizing-tutor')
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (event.type !== 'pointercancel') {
      const latest = measure(body())
      choose(latest.right - event.clientX)
    }
  }
  const onKeyDown = (event) => {
    const step = event.shiftKey ? BIG_STEP : STEP
    const actions = {
      ArrowLeft: () => choose(current + step),
      ArrowRight: () => choose(current - step),
      Home: () => choose(bounds.min),
      End: () => choose(bounds.max),
    }
    if (!actions[event.key]) return
    event.preventDefault()
    actions[event.key]()
  }

  return <div
    ref={handleRef}
    className={`ws-resizer${dragging ? ' is-dragging' : ''}`}
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize tutor"
    aria-controls="ai-tutor-panel"
    aria-valuemin={bounds.min}
    aria-valuemax={bounds.max}
    aria-valuenow={current}
    aria-valuetext={`Tutor width ${current} pixels`}
    tabIndex="0"
    title="Drag to resize the tutor. Double-click to reset."
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={finish}
    onPointerCancel={finish}
    onKeyDown={onKeyDown}
    onDoubleClick={() => choose(null)}
  ><span aria-hidden="true" /></div>
}
