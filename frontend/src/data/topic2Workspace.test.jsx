// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import QuestionPracticePage from '../pages/QuestionPracticePage.jsx'
import SubtopicContent from '../components/SubtopicContent.jsx'
import { getSubtopicQuestions } from './questionBanks.js'
import { syllabus } from './syllabus.js'

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

test('subtopic sections count their questions and include the 2022 papers', async () => {
  const subtopic = syllabus.find((topic) => topic.number === '2').subtopics.find((item) => item.code === '2.8')
  const nonCalculatorCount = getSubtopicQuestions('2.8').filter((question) => !question.paper.calculatorAllowed).length

  render(<MemoryRouter initialEntries={['/topic/2/2.8']}><Routes>
    <Route path="/topic/2/2.8" element={<SubtopicContent subtopic={subtopic} questions={getSubtopicQuestions('2.8')} />} />
    <Route path="/topic/:topicNumber/practice" element={<QuestionPracticePage />} />
  </Routes></MemoryRouter>)

  const section = screen.getByRole('region', { name: 'Non-calculator' })
  expect(within(section).getByText(`${nonCalculatorCount} questions`)).toBeTruthy()
  expect(within(section).getAllByRole('link')).toHaveLength(nonCalculatorCount)
  expect(section.textContent).not.toMatch(/\d+ marks/)

  const paper2022 = section.querySelector('a[href*="4024-s22-11-q21"]')
  expect(paper2022).toBeTruthy()
  fireEvent.click(paper2022)
  expect(await screen.findByRole('heading', { name: 'Inverse proportion' })).toBeTruthy()
})

test('students can filter calculator papers, open a question and save written work locally', async () => {
  render(<MemoryRouter initialEntries={['/topic/2/practice?paper=calculator']}><Routes>
    <Route path="/topic/:topicNumber/practice" element={<QuestionPracticePage />} />
  </Routes></MemoryRouter>)

  expect((await screen.findByRole('combobox', { name: 'Paper type' })).value).toBe('calculator')
  const picker = screen.getByRole('navigation', { name: 'Choose a question' })
  await waitFor(() => expect(within(picker).getAllByRole('button')).toHaveLength(6))
  expect(within(picker).getByRole('button', { name: /^Question 1:/ })).toBeTruthy()
  const answer = screen.getAllByRole('textbox', { name: 'Your working and answer' })[0]
  fireEvent.change(answer, { target: { value: 'My first working step' } })
  await waitFor(() => expect(Object.values(JSON.parse(localStorage.getItem('math-mate-drafts-v1') || '{}')['2'] || {})).toContain('My first working step'))
  expect(screen.getByText('Saved on this device')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: 'Paper type' }), { target: { value: 'non-calculator' } })
  await waitFor(() => expect(screen.getByText('NON-CALCULATOR')).toBeTruthy())
})

test('a drawing question keeps its blank pattern and written answer box', async () => {
  render(<MemoryRouter initialEntries={['/topic/2/practice?question=4024-w24-12-q9']}><Routes>
    <Route path="/topic/:topicNumber/practice" element={<QuestionPracticePage />} />
  </Routes></MemoryRouter>)

  expect(await screen.findByRole('img', { name: 'Pattern 4 is blank' })).toBeTruthy()
  expect(screen.getAllByRole('textbox', { name: 'Your working and answer' }).length).toBeGreaterThan(0)
  expect(screen.queryByText('Sketch your answer')).toBeNull()
  expect(screen.queryByText('Draw here')).toBeNull()
})
