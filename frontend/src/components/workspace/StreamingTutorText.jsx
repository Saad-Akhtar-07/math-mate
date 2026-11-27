import { useEffect, useRef, useState } from 'react'
import TutorText from '../TutorText.jsx'
import {
  prefersReducedTutorMotion,
  tutorStreamChunks,
  TUTOR_STREAM_STEP_MS,
} from '../../utils/tutorStreaming.js'

// The backend has already safety-checked `text`. This component only controls
// its visual reveal, so completing or restoring a turn never waits for it.
export default function StreamingTutorText({ text }) {
  const reducedMotion = prefersReducedTutorMotion()
  const [visible, setVisible] = useState(reducedMotion ? text : '')
  const visibleRef = useRef(reducedMotion ? text : '')
  const targetRef = useRef(reducedMotion ? text : '')
  const queueRef = useRef([])
  const timerRef = useRef(null)

  const clearTimer = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const reveal = (chunk) => {
    visibleRef.current += chunk
    setVisible(visibleRef.current)
  }

  const scheduleNext = () => {
    if (!queueRef.current.length) {
      timerRef.current = null
      return
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      reveal(queueRef.current.shift())
      scheduleNext()
    }, TUTOR_STREAM_STEP_MS)
  }

  useEffect(() => {
    if (reducedMotion) {
      clearTimer()
      queueRef.current = []
      targetRef.current = text
      visibleRef.current = text
      setVisible(text)
      return
    }

    // A reset or replacement must immediately discard text that is no longer
    // authoritative. Normal stream updates only extend the previous target.
    if (!text.startsWith(targetRef.current)) {
      clearTimer()
      queueRef.current = []
      targetRef.current = ''
      visibleRef.current = ''
      setVisible('')
    }

    const suffix = text.slice(targetRef.current.length)
    targetRef.current = text
    queueRef.current.push(...tutorStreamChunks(suffix))
    if (timerRef.current === null && queueRef.current.length) {
      // The first approved words appear without an artificial delay.
      reveal(queueRef.current.shift())
      scheduleNext()
    }
  }, [text, reducedMotion])

  useEffect(() => () => {
    clearTimer()
    queueRef.current = []
  }, [])

  return <span className="ws-stream-text" aria-hidden="true">
    <TutorText text={visible} />
    <span className="ws-stream-caret" aria-hidden="true" />
  </span>
}
