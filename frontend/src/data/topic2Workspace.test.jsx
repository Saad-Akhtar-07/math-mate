// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import QuestionPracticePage from '../pages/QuestionPracticePage.jsx'
import SubtopicPage from '../pages/SubtopicPage.jsx'
import { getQuestionBank } from '../api/content.js'
import { getSubtopicQuestions, getTopicQuestions } from './questionBanks.js'

vi.mock('../api/content.js', async () => {
  const bank = await import('./questionBanks.js')
  return {
    getQuestionBank: vi.fn(async (topicNumber) => ({ questions: bank.getTopicQuestions(topicNumber) })),
    getQuestionPartSolution: vi.fn(async (partId) => bank.getQuestionSolution(partId)),
  }
})

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('subtopic shows a stable question list placeholder while content loads', () => {
  getQuestionBank.mockReturnValueOnce(new Promise(() => {}))
  render(<MemoryRouter initialEntries={['/topic/2/2.6']}><Routes>
    <Route path="/topic/:topicNumber/:subtopicNumber" element={<SubtopicPage />} />
  </Routes></MemoryRouter>)

  expect(screen.getByRole('status', { name: 'Loading questions' })).toBeTruthy()
  expect(document.querySelectorAll('.sl-row-skeleton')).toHaveLength(5)
  expect(screen.queryByText('No questions yet')).toBeNull()
})

test('the subtopic list includes the 2022 papers, filters by paper and opens the workspace in list order', async () => {
  const questions = getSubtopicQuestions('2.8')
  const nonCalculator = questions.filter((question) => !question.paper.calculatorAllowed)
  render(<MemoryRouter initialEntries={['/topic/2/2.8']}><Routes>
    <Route path="/topic/:topicNumber/:subtopicNumber" element={<SubtopicPage />} />
    <Route path="/topic/:topicNumber/practice" element={<QuestionPracticePage />} />
  </Routes></MemoryRouter>)

  const list = await screen.findByRole('region', { name: 'Questions' })
  expect(within(list).getAllByRole('link')).toHaveLength(questions.length)
  expect(screen.getByText(`${questions.length} questions`)).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: 'Paper' }), { target: { value: 'non-calculator' } })
  expect(within(list).getAllByRole('link')).toHaveLength(nonCalculator.length)
  expect(within(list).getByText(`Showing ${nonCalculator.length} of ${nonCalculator.length}`)).toBeTruthy()

  const paper2022 = list.querySelector('a[href*="4024-s22-11-q21"]')
  expect(paper2022.getAttribute('href')).toBe('/topic/2/practice?subtopic=2.8&paper=non-calculator&question=4024-s22-11-q21')
  fireEvent.click(paper2022)
  expect(await screen.findByRole('heading', { name: 'Inverse proportion' })).toBeTruthy()
  const position = nonCalculator.findIndex((question) => question.id === '4024-s22-11-q21') + 1
  expect(screen.getByRole('navigation', { name: 'Question navigation' }).textContent).toBe(`Question ${position} of ${nonCalculator.length}`)
  expect(screen.getByRole('link', { name: '2.8 Proportion' }).getAttribute('href')).toBe('/topic/2/2.8?paper=non-calculator')
})

test('a calculator-paper list steps through its own questions and saves written work locally', async () => {
  const calculatorQuestions = getTopicQuestions('2').filter((question) => question.paper.calculatorAllowed)
  render(<MemoryRouter initialEntries={['/topic/2/practice?paper=calculator']}><Routes>
    <Route path="/topic/:topicNumber/practice" element={<QuestionPracticePage />} />
  </Routes></MemoryRouter>)

  const navigation = await screen.findByRole('navigation', { name: 'Question navigation' })
  expect(navigation.textContent).toBe(`Question 1 of ${calculatorQuestions.length}`)
  expect(screen.getByRole('heading', { level: 1, name: calculatorQuestions[0].title })).toBeTruthy()
  expect(screen.getByText('Calculator')).toBeTruthy()
  // Only the open part has an answer box; the others are collapsed to a summary.
  const answer = screen.getByRole('textbox', { name: 'Your working' })
  fireEvent.change(answer, { target: { value: 'My first working step' } })
  await waitFor(() => expect(Object.values(JSON.parse(localStorage.getItem('math-mate-drafts-v1') || '{}')['2'] || {})).toContain('My first working step'))
  expect(screen.getByText('Saved on this device')).toBeTruthy()
  fireEvent.click(within(navigation).getByRole('button', { name: 'Next question' }))
  await waitFor(() => expect(navigation.textContent).toBe(`Question 2 of ${calculatorQuestions.length}`))
  expect(screen.getByRole('heading', { level: 1, name: calculatorQuestions[1].title })).toBeTruthy()
  expect(screen.queryByText('Non-calculator')).toBeNull()
})

test('a drawing question keeps its blank pattern and written answer box', async () => {
  render(<MemoryRouter initialEntries={['/topic/2/practice?question=4024-w24-12-q9']}><Routes>
    <Route path="/topic/:topicNumber/practice" element={<QuestionPracticePage />} />
  </Routes></MemoryRouter>)

  expect(await screen.findByRole('img', { name: 'Pattern 4 is blank' })).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'Your working' })).toBeTruthy()
  expect(screen.queryByText('Sketch your answer')).toBeNull()
  expect(screen.queryByText('Draw here')).toBeNull()
})
