// @vitest-environment jsdom
// Home, Practice, Progress and the top bar, with every API call mocked: no network and no AI requests.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from '../App.jsx'
import { getQuestionBank, getQuestionSummary } from '../api/content.js'
import { getStudentResponses, getTutorChatTurns, getTutorReviews } from '../api/submissions.js'

vi.mock('../api/content.js', () => ({ getQuestionBank: vi.fn(), getQuestionSummary: vi.fn(), getQuestionPartSolution: vi.fn() }))
vi.mock('../api/submissions.js', async (original) => ({
  ...await original(), getStudentResponses: vi.fn(), getTutorReviews: vi.fn(), getTutorChatTurns: vi.fn(),
}))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ configured: true, loading: false, session: { user: { email: 'student@example.com' } }, user: { email: 'student@example.com' }, signOut: vi.fn() }) }))

const question = (id, code, title, difficulty, parts = ['(a)']) => ({
  id, title, number: 3, total_marks: parts.length * 2, subtopicCodes: [code], difficulty: { label: difficulty }, localDraftOnly: false,
  capabilities: { saveResponses: true, submitResponses: true, uploads: false, aiTutor: true },
  paper: { year: 2024, session: 'May/June', component: '12', calculatorAllowed: false }, prompt: [],
  parts: parts.map((label) => ({ id: `${id}-${label.replace(/\W/g, '')}`, label, marks: 2, prompt: [] })),
})
const questions = [
  question('qa', '2.1', 'Writing an expression', 'easy', ['(a)', '(b)']),
  question('qb', '2.2', 'Expanding brackets', 'medium'),
  question('qc', '2.2', 'Factorising', 'medium'),
  question('qf', '2.2', 'Simplifying terms', 'easy'),
  question('qd', '2.3', 'Adding fractions', 'easy'),
  question('qe', '2.4', 'Using indices', 'easy'),
]
const now = Date.now()
const hoursAgo = (hours) => new Date(now - hours * 3600000).toISOString()
const review = (part, awarded, created) => ({ id: `r-${part}`, question_part_id: part, status: 'completed', outcome: 'marked',
  marks_awarded: awarded, marks_maximum: 2, attempt_number: 1, created_at: created })

function renderAt(path) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}
function returningStudent() {
  getStudentResponses.mockResolvedValue([{ question_part_id: 'qa-b', typed_work: '2x + 3', revision: 1, attachments: [], submitted: false, updated_at: hoursAgo(0.1) }])
  getTutorReviews.mockResolvedValue([review('qa-a', 2, hoursAgo(1)), review('qb-a', 0, hoursAgo(30)), review('qc-a', 1, hoursAgo(2)), review('qd-a', 2, hoursAgo(3))])
  // A hint before (a) was checked makes that full mark assisted.
  getTutorChatTurns.mockResolvedValue([{ id: 't1', question_part_id: 'qa-a', status: 'completed', teaching_move: 'small_hint', created_at: hoursAgo(1.5) }])
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  getQuestionSummary.mockResolvedValue({ topic_counts: { 2: questions.length }, subtopic_counts: {} })
  getQuestionBank.mockResolvedValue({ questions })
  getStudentResponses.mockResolvedValue([])
  getTutorReviews.mockResolvedValue([])
  getTutorChatTurns.mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

test('a new signed-in student gets easy first questions', async () => {
  renderAt('/')
  expect(await screen.findByRole('heading', { level: 1, name: 'Welcome to Math Mate' })).toBeTruthy()
  const start = screen.getByRole('region', { name: 'Good places to start' })
  expect(within(start).getAllByRole('link').map((link) => link.getAttribute('href')).filter((href) => href.includes('question='))).toEqual([
    '/topic/2/practice?subtopic=2.1&question=qa', '/topic/2/practice?subtopic=2.2&question=qf', '/topic/2/practice?subtopic=2.3&question=qd',
  ])
  expect(screen.queryByRole('region', { name: /Writing an expression/ })).toBeNull()
  expect(screen.getByText('Check an answer to see your score.')).toBeTruthy()
  expect(getStudentResponses).toHaveBeenCalled()
  expect(getTutorReviews).toHaveBeenCalled()
})

test('a returning student sees where to continue, suggestions with reasons and their week', async () => {
  returningStudent()
  renderAt('/')
  const resume = await screen.findByRole('region', { name: 'Writing an expression' })
  expect(within(resume).getByText('(a) 2 of 2')).toBeTruthy()
  expect(within(resume).getByText('(b) Working saved, not checked yet')).toBeTruthy()
  expect(within(resume).getByRole('link', { name: 'Continue part (b)' }).getAttribute('href')).toBe('/topic/2/practice?subtopic=2.1&question=qa')

  const suggested = screen.getByRole('region', { name: 'Suggested next' })
  const cards = within(suggested).getAllByRole('link').filter((link) => link.getAttribute('href').includes('question='))
  expect(cards.map((card) => card.getAttribute('href').split('question=')[1])).toEqual(['qc', 'qf', 'qe'])
  expect(cards[0].textContent).toContain('You scored 1 of 2 last time.')
  expect(cards[1].textContent).toContain('Algebraic manipulation is your lowest-scoring subtopic so far, at 25%.')

  const side = screen.getByRole('complementary', { name: 'Your progress' })
  expect(within(side).getByText('4 of 6')).toBeTruthy()
  expect(within(side).getByText('63%')).toBeTruthy()
  expect(within(side).getByRole('listitem', { name: 'Today, practised' })).toBeTruthy()
})

test('the top bar marks the current section and is hidden in the workspace', async () => {
  renderAt('/topic/2')
  const nav = await screen.findByRole('navigation', { name: 'Main' })
  expect(within(nav).getByRole('link', { name: 'Practice' }).getAttribute('aria-current')).toBe('page')
  expect(within(nav).getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBeNull()
  cleanup()
  renderAt('/progress')
  expect(within(await screen.findByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Progress' }).getAttribute('aria-current')).toBe('page')
  cleanup()
  renderAt('/topic/2/practice?question=qa')
  await screen.findByRole('navigation', { name: 'Question navigation' })
  expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
})

test('/practice opens the first topic with questions', async () => {
  renderAt('/practice')
  expect(await screen.findByRole('heading', { level: 2, name: 'Algebra and graphs' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '2 Algebra and graphs' }).getAttribute('aria-current')).toBe('page')
})

test('practice lists every subtopic with progress and the focus area', async () => {
  returningStudent()
  renderAt('/topic/2')
  const topicCard = await screen.findByRole('region', { name: 'Algebra and graphs' })
  await within(topicCard).findByText('6 questions · 12 subtopics · You have tried 4')
  const manipulation = within(topicCard).getByRole('link', { name: /2\.2 Algebraic manipulation/ })
  expect(manipulation.textContent).toContain('Focus area')
  expect(manipulation.textContent).toContain('2 tried · 25%')
  expect(manipulation.getAttribute('href')).toBe('/topic/2/2.2')
  expect(within(topicCard).getByRole('link', { name: /2\.5 Equations/ }).textContent).toContain('Questions coming soon')
  const soon = [...document.querySelectorAll('.pr-topic[aria-disabled="true"]')].map((item) => item.textContent)
  expect(soon).toContain('1Number (coming soon)')
  expect(screen.queryByRole('link', { name: /Number/ })).toBeNull()
  expect(screen.getByText('Other topics are coming soon.')).toBeTruthy()
})

test('progress shows totals, weakest subtopics first and help-free full marks', async () => {
  returningStudent()
  renderAt('/progress')
  const tiles = await screen.findAllByRole('region', { name: /Questions tried|Average score|Full marks without help/ })
  // Help-free marks wait for the tutor history rather than guessing.
  await waitFor(() => expect(tiles.map((tile) => tile.querySelector('.pg-number').textContent)).toEqual(['4 of 6', '63%', '1']))
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
  expect(rows.map((row) => row.cells[0].textContent)).toEqual(['2.2Algebraic manipulationFocus area', '2.1Introduction to algebra', '2.3Algebraic fractions'])
  expect(rows.map((row) => row.cells[3].textContent)).toEqual(['0 of 2', '0 of 1', '1 of 1'])
  const recent = screen.getByRole('region', { name: 'Recent attempts' })
  const attempts = within(recent).getAllByRole('link')
  expect(attempts).toHaveLength(4)
  expect(attempts[0].textContent).toContain('Writing an expression · (a)')
  expect(attempts[0].textContent).toContain('With help')
  expect(attempts[1].textContent).toContain('Factorising')
  expect(attempts[1].textContent).toContain('Without help')
})

test('progress invites a new student to start', async () => {
  renderAt('/progress')
  expect(await screen.findByRole('heading', { name: 'Your progress will appear here' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Start practising' }).getAttribute('href')).toBe('/topic/2')
  expect(getTutorChatTurns).toHaveBeenCalled()
})

test('progress says so when tutor history is unavailable instead of guessing', async () => {
  returningStudent()
  getTutorChatTurns.mockRejectedValue(new Error('offline'))
  renderAt('/progress')
  await waitFor(() => expect(screen.getByText('Tutor history could not be loaded')).toBeTruthy())
  expect(screen.getByRole('region', { name: 'Full marks without help' }).querySelector('.pg-number').textContent).toBe('–')
})
