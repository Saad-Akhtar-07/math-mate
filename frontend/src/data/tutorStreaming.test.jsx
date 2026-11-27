// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import StreamingTutorText from '../components/workspace/StreamingTutorText.jsx'
import { TUTOR_STREAM_STEP_MS } from '../utils/tutorStreaming.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('only the streaming text rerenders and reset cancels queued words', () => {
  const view = render(<StreamingTutorText text="one two three four five six seven eight" />)
  const stream = () => view.container.querySelector('.ws-stream-text')
  expect(stream().textContent).toBe('one ')

  act(() => vi.advanceTimersByTime(TUTOR_STREAM_STEP_MS))
  expect(stream().textContent).toBe('one two ')

  view.rerender(<StreamingTutorText text="replacement words must cancel the older queue completely" />)
  expect(stream().textContent).toBe('replacement ')
  view.rerender(<StreamingTutorText text="" />)
  expect(stream().textContent).toBe('')
  expect(vi.getTimerCount()).toBe(0)

  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

test('reduced-motion preference reveals approved text immediately', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  const reply = 'All of this approved tutor sentence should appear together.'
  const view = render(<StreamingTutorText text={reply} />)
  expect(view.container.querySelector('.ws-stream-text').textContent).toBe(reply)
  expect(vi.getTimerCount()).toBe(0)
})
