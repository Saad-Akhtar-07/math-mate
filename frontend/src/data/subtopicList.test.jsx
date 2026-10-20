// @vitest-environment jsdom
// Subtopic question list with progress, every API call mocked.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getQuestionBank } from '../api/content.js'
import { getStudentResponses, getTutorReviews, hasGuestSession } from '../api/submissions.js'
import SubtopicPage from '../pages/SubtopicPage.jsx'

vi.mock('../api/content.js', () => ({ getQuestionBank: vi.fn(), getQuestionPartSolution: vi.fn() }))
vi.mock('../api/submissions.js', async (original) => ({
  ...await original(), getStudentResponses: vi.fn(), getTutorReviews: vi.fn(), hasGuestSession: vi.fn(),
}))

const paper = (calculatorAllowed) => ({ year: 2024, session: 'May/June', component: calculatorAllowed ? '22' : '12', calculatorAllowed })
const question = (id, title, difficulty, calculatorAllowed = false) => ({
  id, title, number: 1, total_marks: 2, subtopicCodes: ['2.5'], localDraftOnly: false, difficulty: { label: difficulty },
  capabilities: { saveResponses: true, submitResponses: true, uploads: false, aiTutor: true }, paper: paper(calculatorAllowed),
  prompt: [], parts: [{ id: `${id}-a`, label: '(a)', marks: 2, prompt: [] }],
})
const questions = [
  question('q-done', 'Solving a linear equation', 'easy'),
  question('q-retry', 'Changing the subject of a formula', 'medium'),
  question('q-new', 'Simultaneous linear equations', 'hard', true),
  question('q-draft', 'Constructing an expression', 'medium'),
  { ...question('q-other', 'Sequences question', 'easy'), subtopicCodes: ['2.7'] },
]
const review = (part, awarded) => ({ question_part_id: part, status: 'completed', outcome: 'marked', marks_awarded: awarded,
  marks_maximum: 2, attempt_number: 1, created_at: '2026-10-19T10:00:00Z' })

function renderList(path = '/topic/2/2.5') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/topic/:topicNumber/:subtopicNumber" element={<SubtopicPage />} />
  </Routes></MemoryRouter>)
}
const row = (list, title) => within(list).getByText(title).closest('a')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  getQuestionBank.mockResolvedValue({ questions })
  hasGuestSession.mockReturnValue(true)
  getStudentResponses.mockResolvedValue([{ question_part_id: 'q-draft-a', typed_work: '3x + 5', revision: 1, attachments: [], submitted: false }])
  getTutorReviews.mockResolvedValue([review('q-done-a', 2), review('q-retry-a', 1)])
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

test('rows show each question’s progress and the header sums it up', async () => {
  renderList()
  const list = await screen.findByRole('region', { name: 'Questions' })
  expect(await within(list).findByText('2 of 2 marks')).toBeTruthy()
  expect(within(list).getAllByRole('link')).toHaveLength(4)
  expect(row(list, 'Changing the subject of a formula').textContent).toContain('Try again · 1 of 2')
  expect(row(list, 'Constructing an expression').textContent).toContain('In progress')
  expect(row(list, 'Simultaneous linear equations').textContent).toContain('2 marks')
  expect(row(list, 'Simultaneous linear equations').textContent).toContain('Calculator')
  expect(screen.getByText('4 questions · You have tried 3 · Average score 75%')).toBeTruthy()
  // Work already started comes first.
  const start = screen.getByRole('link', { name: 'Continue question' })
  expect(start.getAttribute('href')).toBe('/topic/2/practice?subtopic=2.5&question=q-draft')
  expect(getStudentResponses).toHaveBeenCalledWith('2')
  expect(getTutorReviews).toHaveBeenCalledWith('2')
})

test('status filters show counts and narrow the list', async () => {
  renderList()
  const list = await screen.findByRole('region', { name: 'Questions' })
  await within(list).findByText('2 of 2 marks')
  const filters = screen.getByRole('group', { name: 'Show questions' })
  expect(within(filters).getByRole('button', { name: 'Try again 1' })).toBeTruthy()
  expect(within(filters).getByRole('button', { name: 'Not started 1' })).toBeTruthy()
  fireEvent.click(within(filters).getByRole('button', { name: 'Try again 1' }))
  expect(within(list).getAllByRole('link')).toHaveLength(1)
  expect(within(filters).getByRole('button', { name: 'Try again 1' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(within(list).getAllByRole('link')).toHaveLength(4)
})

test('difficulty filtering carries into the workspace so Next follows the same list', async () => {
  renderList('/topic/2/2.5?difficulty=medium')
  const list = await screen.findByRole('region', { name: 'Questions' })
  expect(within(list).getAllByRole('link')).toHaveLength(2)
  expect(row(list, 'Changing the subject of a formula').getAttribute('href'))
    .toBe('/topic/2/practice?subtopic=2.5&difficulty=medium&question=q-retry')
})

test('a visitor without a guest workspace browses without any learner requests', async () => {
  hasGuestSession.mockReturnValue(false)
  renderList()
  const list = await screen.findByRole('region', { name: 'Questions' })
  expect(within(list).getAllByRole('link')).toHaveLength(4)
  expect(within(list).queryByText('2 of 2 marks')).toBeNull()
  expect(screen.getByText('4 questions')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Start next question' })).toBeTruthy()
  expect(getStudentResponses).not.toHaveBeenCalled()
  expect(getTutorReviews).not.toHaveBeenCalled()
})

test('a progress failure keeps every question available', async () => {
  getStudentResponses.mockRejectedValue(new Error('Server unavailable'))
  renderList()
  expect(await screen.findByText('Your progress could not be loaded. You can still practise every question.')).toBeTruthy()
  expect(within(screen.getByRole('region', { name: 'Questions' })).getAllByRole('link')).toHaveLength(4)
})
