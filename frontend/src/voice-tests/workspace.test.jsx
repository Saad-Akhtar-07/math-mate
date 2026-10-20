// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import QuestionPracticePage from '../pages/QuestionPracticePage.jsx'
import PracticePage from '../pages/PracticePage.jsx'

vi.mock('../api/content.js', () => ({
  getQuestionBank: vi.fn().mockResolvedValue({
    total_marks: 1,
    questions: [{
      id: 'question-one', number: 9, title: 'A daily commute', total_marks: 1,
      syllabus_codes: ['8.3'], prompt: [],
      parts: [{ id: 'part-one', label: '(a)', marks: 1, prompt: [] }],
    }],
  }),
  getQuestionCount: vi.fn().mockResolvedValue(1),
  getQuestionSummary: vi.fn().mockResolvedValue({ topic_counts: { 8: 1 }, subtopic_counts: {} }),
  getQuestionPartSolution: vi.fn(),
}))
vi.mock('../api/submissions.js', async importOriginal => ({
  ...await importOriginal(),
  getStudentResponses: vi.fn().mockResolvedValue([]),
  getTutorReviews: vi.fn().mockResolvedValue([]),
  getTutorChatTurns: vi.fn().mockResolvedValue([{
    id: 'turn-one', client_message_id: 'message-one', question_part_id: 'part-one',
    status: 'completed', teaching_move: 'small_hint', created_at: '2026-09-17T10:00:00Z',
    learner_message: 'Can you give me hints?', tutor_message: 'Think about the two possible outcomes.',
  }]),
}))

function renderWorkspace(path = '/topic/8/practice') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/topic/:topicNumber/practice" element={<QuestionPracticePage />} />
    <Route path="/topic/:topicNumber" element={<PracticePage />} />
  </Routes></MemoryRouter>)
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('hiding and showing the tutor keeps the chat draft and is remembered', async () => {
  await act(async () => { renderWorkspace() })
  await screen.findByText('Think about the two possible outcomes.')
  const composer = screen.getByRole('textbox', { name: 'Message the tutor' })
  fireEvent.change(composer, { target: { value: 'What should I consider next?' } })
  const tutor = screen.getByRole('complementary', { name: 'Tutor' })
  const toggle = within(screen.getByRole('banner')).getByRole('button', { name: 'Tutor' })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(within(tutor).getByRole('button', { name: 'Hide tutor' }))
  expect(tutor.classList.contains('is-closed')).toBe(true)
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  expect(localStorage.getItem('practice-tutor-open-v1')).toBe('false')
  fireEvent.click(toggle)
  expect(tutor.classList.contains('is-closed')).toBe(false)
  expect(composer.value).toBe('What should I consider next?')
  expect(screen.getByText('Think about the two possible outcomes.')).toBeTruthy()
  expect(localStorage.getItem('practice-tutor-open-v1')).toBe('true')
  cleanup()
  localStorage.setItem('practice-tutor-open-v1', 'false')
  await act(async () => { renderWorkspace() })
  expect(screen.getByRole('complementary', { name: 'Tutor', hidden: true }).classList.contains('is-closed')).toBe(true)
})

test('the workspace replaces the syllabus sidebar with a back link and question navigation', async () => {
  await act(async () => { renderWorkspace() })
  await screen.findByText('Think about the two possible outcomes.')
  expect(screen.queryByRole('button', { name: 'Collapse syllabus sidebar' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Probability' }).getAttribute('href')).toBe('/topic/8')
  expect(screen.getByRole('navigation', { name: 'Question navigation' }).textContent).toBe('Question 1 of 1')
  fireEvent.click(screen.getByRole('link', { name: 'Probability' }))
  expect(await screen.findByRole('heading', { name: 'Probability' })).toBeTruthy()
})

test('voice settings stay out of the conversation and can be dismissed with Escape', async () => {
  await act(async () => { renderWorkspace() })
  await screen.findByText('Think about the two possible outcomes.')
  expect(screen.queryByRole('combobox', { name: 'Tutor voice' })).toBeNull()
  const settings = screen.getByRole('button', { name: 'Voice settings' })
  fireEvent.click(settings)
  expect(screen.getByRole('combobox', { name: 'Tutor voice' }).value).toBe('device')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('combobox', { name: 'Tutor voice' })).toBeNull()
  expect(settings.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(settings)
})
