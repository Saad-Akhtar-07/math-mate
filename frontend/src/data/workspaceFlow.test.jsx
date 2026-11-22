// @vitest-environment jsdom
// Practice workspace behaviour with every API call mocked: no network and no AI requests.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getQuestionBank } from '../api/content.js'
import {
  getStudentResponses, getTutorChatTurns, getTutorReviews, requestTutorReview, saveStudentResponse,
  sendTutorChatMessage, submitStudentResponse, uploadSolutionImage,
} from '../api/submissions.js'
import QuestionPracticePage from '../pages/QuestionPracticePage.jsx'

vi.mock('../api/content.js', () => ({ getQuestionBank: vi.fn(), getQuestionPartSolution: vi.fn() }))
vi.mock('../api/submissions.js', async (original) => ({
  ...await original(),
  getStudentResponses: vi.fn(), getStudentResponse: vi.fn(), saveStudentResponse: vi.fn(), submitStudentResponse: vi.fn(),
  getTutorReviews: vi.fn(), getTutorChatTurns: vi.fn(), requestTutorReview: vi.fn(), sendTutorChatMessage: vi.fn(),
  getResponseSubmissions: vi.fn(), uploadSolutionImage: vi.fn(), getSolutionImageUrl: vi.fn(async () => ({ url: 'https://storage.example.test/page.jpg' })),
}))

const paragraph = (content) => ({ type: 'paragraph', content })
const capabilities = (aiTutor = true) => ({ saveResponses: true, submitResponses: true, uploads: false, aiTutor })
const question = (parts, fields = {}) => ({
  id: 'q1', number: 4, title: 'Counters in a bag', prompt: [paragraph('A bag holds red and blue counters.')], total_marks: 4,
  localDraftOnly: false, capabilities: capabilities(), parts,
  paper: { year: 2024, session: 'May/June', component: '12', calculatorAllowed: false }, ...fields,
})
const marked = (fields) => ({
  id: 'r1', question_part_id: 'q1-a', attempt_number: 1, status: 'completed', outcome: 'marked',
  marks_awarded: 1, marks_maximum: 2, feedback: 'Look again at your second line.', what_i_read: 'x + 2 = 7', can_retry: false,
  created_at: '2026-10-19T10:00:00Z', ...fields,
})

let revision
function workspace(questions) {
  getQuestionBank.mockResolvedValue({ questions })
  return render(<MemoryRouter initialEntries={['/topic/2/practice']}><Routes>
    <Route path="/topic/:topicNumber/practice" element={<QuestionPracticePage />} />
  </Routes></MemoryRouter>)
}
async function openAnswer() {
  const answer = await screen.findByRole('textbox', { name: 'Your working' })
  await waitFor(() => expect(answer.disabled).toBe(false))
  return answer
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollIntoView = vi.fn()
  revision = 0
  getStudentResponses.mockResolvedValue([])
  getTutorReviews.mockResolvedValue([])
  getTutorChatTurns.mockResolvedValue([])
  saveStudentResponse.mockImplementation(async (partId, text, expected) => {
    revision = expected + 1
    return { question_part_id: partId, typed_work: text, revision, attachments: [], submitted: false }
  })
  submitStudentResponse.mockResolvedValue({ id: 'submission' })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

test('Check my work submits once, shows marks by the working and feedback in the tutor', async () => {
  requestTutorReview.mockResolvedValue(marked({}))
  workspace([question([{ id: 'q1-a', label: '(a)', marks: 2, prompt: [paragraph('Solve x + 2 = 7.')] }])])
  const answer = await openAnswer()
  expect(screen.queryByRole('button', { name: 'Submit answer' })).toBeNull()
  fireEvent.change(answer, { target: { value: 'x = 5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Check my work' }))

  expect(await screen.findByText('1 of 2 marks')).toBeTruthy()
  expect(saveStudentResponse).toHaveBeenCalledWith('q1-a', 'x = 5', 0)
  expect(requestTutorReview).toHaveBeenCalledWith('q1-a', 1)
  expect(submitStudentResponse).not.toHaveBeenCalled()
  expect(screen.getByText('Attempt 1 · Independent')).toBeTruthy()
  const tutor = screen.getByRole('complementary', { name: 'Tutor' })
  expect(within(tutor).getByText('Look again at your second line.')).toBeTruthy()
  expect(within(tutor).getByText('Attempt 1 checked · 1 of 2')).toBeTruthy()

  // The same work cannot be checked twice; changing it allows a new attempt.
  expect(screen.getByRole('button', { name: 'Check again' }).disabled).toBe(true)
  expect(screen.getByText('Change your working to check again')).toBeTruthy()
  fireEvent.change(answer, { target: { value: 'x = 7 - 2' } })
  expect(screen.getByRole('button', { name: 'Check my work' }).disabled).toBe(false)

  const reading = screen.getByRole('button', { name: 'What I read' })
  fireEvent.click(reading)
  expect(reading.getAttribute('aria-expanded')).toBe('true')
})

test('lost marks open concise teacher-style marking with optional examiner details', async () => {
  getTutorReviews.mockResolvedValue([marked({
    what_i_read: 'x + 2 = 7\nx = 9',
    review: { points: [{ code: 'M1', value: 1, awarded: true }, { code: 'A1', value: 1, awarded: false }],
      mistakes: [{ step: 'x = 9', type: 'calculation', marks_lost: ['A1'] }] },
  })])
  getStudentResponses.mockResolvedValue([{ question_part_id: 'q1-a', typed_work: 'x + 2 = 7\nx = 9', revision: 1, attachments: [], submitted: true }])
  workspace([question([{ id: 'q1-a', label: '(a)', marks: 2, prompt: [paragraph('Solve x + 2 = 7.')] }])])

  const toggle = await screen.findByRole('button', { name: 'Hide marking' })
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('Attempt 1 · Independent · 1 step to review')).toBeTruthy()
  const details = screen.getByText('Mark details').closest('details')
  expect(details.open).toBe(false)
  const marks = screen.getByRole('list', { name: 'Marks earned and lost' })
  expect(within(marks).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['EarnedM1', 'LostA1'])
  const lines = within(screen.getByRole('list', { name: 'Your working, as it was read' })).getAllByRole('listitem')
  expect(lines[0].textContent).toBe('x + 2 = 7')
  expect(lines[1].textContent).toBe('Marks lost herex = 9Calculation slip')
  expect(screen.getByText('Revise the × or ∧ step, then check your work again. Your tutor can give a hint without revealing the answer.')).toBeTruthy()

  fireEvent.click(toggle)
  expect(screen.queryByRole('list', { name: 'Your working, as it was read' })).toBeNull()
})

test('missing and unmatched issues never print a proposed correction', async () => {
  getTutorReviews.mockResolvedValue([marked({
    marks_awarded: 0,
    what_i_read: 'x + 2 = 7',
    review: { points: [{ code: 'M1', value: 1, awarded: false }], mistakes: [
      { step: 'Missing step: x = 7 - 2', type: 'method', marks_lost: ['M1'] },
      { step: 'x = 5', type: 'calculation', marks_lost: [] },
    ] },
  })])
  getStudentResponses.mockResolvedValue([{ question_part_id: 'q1-a', typed_work: 'x + 2 = 7', revision: 1, attachments: [], submitted: true }])
  workspace([question([{ id: 'q1-a', label: '(a)', marks: 2, prompt: [paragraph('Solve x + 2 = 7.')] }])])

  expect(await screen.findByText('A required step is missing')).toBeTruthy()
  expect(screen.getByText('A step needs attention')).toBeTruthy()
  expect(screen.queryByText('x = 7 - 2')).toBeNull()
  expect(screen.queryByText('x = 5')).toBeNull()
})

test('nested parts show their shared text once and only the open part has an answer box', async () => {
  const shared = paragraph('One counter is taken at random.')
  workspace([question([
    { id: 'q1-a-i', label: '(a)(i)', marks: 1, prompt: [shared, paragraph('Find the probability that it is red.')] },
    { id: 'q1-a-ii', label: '(a)(ii)', marks: 1, prompt: [shared, paragraph('Find the probability that it is blue.')] },
    { id: 'q1-b', label: '(b)', marks: 2, prompt: [paragraph('Two counters are taken.')] },
  ])])
  await openAnswer()
  expect(screen.getAllByText('One counter is taken at random.')).toHaveLength(1)
  expect(screen.getAllByRole('textbox', { name: 'Your working' })).toHaveLength(1)
  expect(screen.getByRole('region', { name: 'Part (a)(i), current part' })).toBeTruthy()

  const collapsed = within(screen.getByRole('region', { name: 'Part (a)(ii)' })).getByRole('button')
  expect(collapsed.getAttribute('aria-expanded')).toBe('false')
  expect(collapsed.textContent).toContain('Not started')
  fireEvent.click(collapsed)
  expect(screen.getByRole('region', { name: 'Part (a)(ii), current part' })).toBeTruthy()
  expect(screen.getByText('Find the probability that it is blue.')).toBeTruthy()
  expect(screen.getByText('Helping with part (a)(ii)')).toBeTruthy()
})

test('a part with full marks stays collapsed and offers the next part', async () => {
  getTutorReviews.mockResolvedValue([marked({ marks_awarded: 2 })])
  getStudentResponses.mockResolvedValue([{ question_part_id: 'q1-a', typed_work: 'x = 5', revision: 1, attachments: [], submitted: true }])
  workspace([question([
    { id: 'q1-a', label: '(a)', marks: 2, prompt: [paragraph('Solve x + 2 = 7.')] },
    { id: 'q1-b', label: '(b)', marks: 2, prompt: [paragraph('Solve 2x = 9.')] },
  ])])
  // The first part still needing work opens first.
  expect(await screen.findByRole('region', { name: 'Part (b), current part' })).toBeTruthy()
  const solved = within(screen.getByRole('region', { name: 'Part (a)' })).getByRole('button')
  expect(solved.textContent).toContain('2 of 2')
  fireEvent.click(solved)
  expect(await screen.findByText('2 of 2 marks')).toBeTruthy()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Checked' }).disabled).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: 'Next part' }))
  expect(screen.getByRole('region', { name: 'Part (b), current part' })).toBeTruthy()
})

test('a photo-only visual answer is saved before one AI check', async () => {
  const pages = []
  requestTutorReview.mockResolvedValue(marked({ marks_awarded: 2 }))
  saveStudentResponse.mockImplementation(async (partId, text, expected, visualAnswer) => {
    revision = expected + (revision === 0 ? 1 : 0)
    return { question_part_id: partId, typed_work: text, visual_answer: visualAnswer,
      revision, attachments: pages, submitted: false }
  })
  uploadSolutionImage.mockImplementation(async (partId, file, expected, options) => {
    expect(options.role).toBe('primary_visual')
    expect(options.visualSource).toBe('photo')
    revision = expected + 1
    pages.splice(0, pages.length, { id: 'primary', file_id: 'file', role: 'primary_visual',
      visual_source: 'photo', original_filename: file.name, position: 1 })
    return { question_part_id: partId, typed_work: '', revision, attachments: pages, submitted: false }
  })
  workspace([question([{ id: 'q1-a', label: '(a)', marks: 2, aiMarkable: true, visualResponse: true,
    prompt: [paragraph('Draw the graph.')] }], { capabilities: { ...capabilities(), uploads: true } })])

  await screen.findByRole('textbox', { name: 'Calculations or explanation (optional)' })
  expect(screen.getByRole('button', { name: 'Check my work' }).disabled).toBe(true)
  const primaryInput = screen.getByLabelText('Upload visual answer')
  await waitFor(() => expect(primaryInput.disabled).toBe(false))
  fireEvent.change(primaryInput, { target: { files: [new File(['visual'], 'graph.jpg', { type: 'image/jpeg' })] } })
  await waitFor(() => expect(uploadSolutionImage).toHaveBeenCalledTimes(1))
  await screen.findByText(/solution page saved/)
  const check = screen.getByRole('button', { name: 'Check my work' })
  await waitFor(() => expect(check.disabled).toBe(false))
  fireEvent.click(check)

  expect(await screen.findByText('2 of 2 marks')).toBeTruthy()
  expect(uploadSolutionImage).toHaveBeenCalledTimes(1)
  expect(requestTutorReview).toHaveBeenCalledWith('q1-a', 2)
  expect(submitStudentResponse).not.toHaveBeenCalled()
})

test('an old canvas preview cannot stand in for a newly selected photo', async () => {
  getStudentResponses.mockResolvedValue([{
    question_part_id: 'q1-a', typed_work: '', revision: 2, submitted: false,
    visual_answer: { version: 'visual-answer-v1', primary_source: 'photo', objects: [] },
    attachments: [{ id: 'old', file_id: 'old', role: 'primary_visual', visual_source: 'canvas',
      original_filename: 'q1-a-visual-answer.jpg', position: 1 }],
  }])
  workspace([question([{ id: 'q1-a', label: '(a)', marks: 2, aiMarkable: true, visualResponse: true,
    prompt: [paragraph('Draw the graph.')] }], { capabilities: { ...capabilities(), uploads: true } })])

  await screen.findByRole('textbox', { name: 'Calculations or explanation (optional)' })
  expect(await screen.findByText('Upload one clear photo showing the complete graph or diagram.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Check my work' }).disabled).toBe(true)
  expect(requestTutorReview).not.toHaveBeenCalled()
})

test('without AI the tutor says it is unavailable and offers no requests', async () => {
  workspace([question([{ id: 'q1-a', label: '(a)', marks: 2, prompt: [paragraph('Solve x + 2 = 7.')] }], { capabilities: capabilities(false) })])
  await openAnswer()
  const tutor = screen.getByRole('complementary', { name: 'Tutor' })
  expect(within(tutor).getByText('The tutor is not available yet.')).toBeTruthy()
  expect(within(tutor).queryByRole('button', { name: 'Give me a hint' })).toBeNull()
  expect(within(tutor).getByRole('textbox', { name: 'Message the tutor' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Submit answer' })).toBeTruthy()
  expect(getTutorReviews).not.toHaveBeenCalled()
})

test('quick requests send the matching intent and the help bar shows the level reached', async () => {
  sendTutorChatMessage.mockImplementation(async (partId, message, clientMessageId, { intent }) => ({
    id: `turn-${intent}`, client_message_id: clientMessageId, question_part_id: partId, intent, learner_message: message,
    status: 'completed', teaching_move: intent === 'hint' ? 'small_hint' : 'explain_concept',
    tutor_message: intent === 'hint' ? 'What undoes adding 2?' : 'An equation stays balanced.', created_at: new Date().toISOString(),
  }))
  workspace([question([{ id: 'q1-a', label: '(a)', marks: 2, prompt: [paragraph('Solve x + 2 = 7.')] }])])
  await openAnswer()
  const tutor = screen.getByRole('complementary', { name: 'Tutor' })
  expect(within(tutor).getByText('None yet')).toBeTruthy()

  fireEvent.click(within(tutor).getByRole('button', { name: 'Give me a hint' }))
  expect(await within(tutor).findByText('What undoes adding 2?')).toBeTruthy()
  expect(sendTutorChatMessage.mock.calls[0][3].intent).toBe('hint')
  expect(within(tutor).getByText('Level 2 of 5 · Small hint')).toBeTruthy()

  await waitFor(() => expect(within(tutor).getByRole('button', { name: 'Explain the idea' }).disabled).toBe(false))
  fireEvent.click(within(tutor).getByRole('button', { name: 'Explain the idea' }))
  expect(await within(tutor).findByText('An equation stays balanced.')).toBeTruthy()
  expect(sendTutorChatMessage.mock.calls[1][3].intent).toBe('explain')
  expect(within(tutor).getByText('Level 3 of 5 · Concept explanation')).toBeTruthy()
  expect(requestTutorReview).not.toHaveBeenCalled()
})

test('the tutor can be resized within limits by keyboard, remembered and reset', async () => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1400, right: 1400, left: 0, top: 0, bottom: 800, height: 800 })
  const view = workspace([question([{ id: 'q1-a', label: '(a)', marks: 2, prompt: [paragraph('Solve x + 2 = 7.')] }])])
  await openAnswer()
  const handle = screen.getByRole('separator', { name: 'Resize tutor' })
  const body = document.querySelector('.ws-body')
  expect([handle.getAttribute('aria-valuemin'), handle.getAttribute('aria-valuemax'), handle.getAttribute('aria-valuenow')]).toEqual(['380', '760', '540'])
  // Until the learner resizes, the CSS default applies.
  expect(body.style.getPropertyValue('--tutor-width')).toBe('')

  fireEvent.keyDown(handle, { key: 'ArrowLeft' })
  expect(handle.getAttribute('aria-valuenow')).toBe('564')
  expect(body.style.getPropertyValue('--tutor-width')).toBe('564px')
  expect(localStorage.getItem('practice-tutor-width-v1')).toBe('564')
  fireEvent.keyDown(handle, { key: 'End' })
  fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
  expect(handle.getAttribute('aria-valuenow')).toBe('760')
  fireEvent.keyDown(handle, { key: 'Home' })
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(handle.getAttribute('aria-valuenow')).toBe('380')

  fireEvent.doubleClick(handle)
  expect(handle.getAttribute('aria-valuenow')).toBe('540')
  expect(body.style.getPropertyValue('--tutor-width')).toBe('')
  expect(localStorage.getItem('practice-tutor-width-v1')).toBeNull()

  // A saved width wider than this window allows is clamped, and the handle goes with the tutor.
  view.unmount()
  localStorage.setItem('practice-tutor-width-v1', '2000')
  workspace([question([{ id: 'q1-a', label: '(a)', marks: 2, prompt: [paragraph('Solve x + 2 = 7.')] }])])
  await openAnswer()
  expect(screen.getByRole('separator', { name: 'Resize tutor' }).getAttribute('aria-valuenow')).toBe('760')
  expect(document.querySelector('.ws-body').style.getPropertyValue('--tutor-width')).toBe('760px')
  fireEvent.click(within(screen.getByRole('complementary', { name: 'Tutor' })).getByRole('button', { name: 'Hide tutor' }))
  expect(screen.queryByRole('separator', { name: 'Resize tutor' })).toBeNull()
})

test('dragging the handle follows the pointer and saves the width on release', async () => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1400, right: 1400, left: 0, top: 0, bottom: 800, height: 800 })
  // Frames run when the test flushes them, as a browser runs them after events.
  let frames = []
  const flushFrames = () => act(() => { const queued = frames; frames = []; queued.forEach((callback) => callback()) })
  vi.stubGlobal('requestAnimationFrame', (callback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  // jsdom has no PointerEvent; a MouseEvent carries the same clientX and button.
  vi.stubGlobal('PointerEvent', class extends MouseEvent { constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId } })
  workspace([question([{ id: 'q1-a', label: '(a)', marks: 2, prompt: [paragraph('Solve x + 2 = 7.')] }])])
  await openAnswer()
  const handle = screen.getByRole('separator', { name: 'Resize tutor' })
  fireEvent.pointerDown(handle, { button: 0, clientX: 860, pointerId: 1 })
  expect(document.documentElement.classList.contains('is-resizing-tutor')).toBe(true)
  // Two moves in one frame: the later position wins.
  fireEvent.pointerMove(handle, { clientX: 820, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: 800, pointerId: 1 })
  flushFrames()
  expect(handle.getAttribute('aria-valuenow')).toBe('600')
  expect(localStorage.getItem('practice-tutor-width-v1')).toBeNull()
  // Past the limit the width stops at the maximum.
  fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 })
  flushFrames()
  expect(handle.getAttribute('aria-valuenow')).toBe('760')
  fireEvent.pointerUp(handle, { clientX: 700, pointerId: 1 })
  expect(handle.getAttribute('aria-valuenow')).toBe('700')
  expect(localStorage.getItem('practice-tutor-width-v1')).toBe('700')
  expect(document.documentElement.classList.contains('is-resizing-tutor')).toBe(false)
  vi.unstubAllGlobals()
})

const withUploads = () => ({ saveResponses: true, submitResponses: true, uploads: true, aiTutor: true })
const touchScreen = (isTouch) => vi.stubGlobal('matchMedia', (query) => ({
  matches: isTouch && query === '(pointer: coarse)', media: query, addEventListener: () => {}, removeEventListener: () => {},
}))

test('on a touch screen the camera opens directly and the gallery stays available', async () => {
  touchScreen(true)
  uploadSolutionImage.mockImplementation(async (partId, file, expected) => ({ question_part_id: partId, typed_work: '', revision: expected + 1,
    attachments: [{ id: 'p1', file_id: 'p1', original_filename: file.name, position: 1 }], submitted: false }))
  workspace([question([{ id: 'q1-a', label: '(a)', marks: 2, prompt: [paragraph('Solve x + 2 = 7.')] }], { capabilities: withUploads() })])
  await openAnswer()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Take photo' }).disabled).toBe(false))
  expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Add photo of working' })).toBeNull()
  const camera = screen.getByLabelText('Take a photo of your working')
  expect(camera.getAttribute('capture')).toBe('environment')
  expect(camera.multiple).toBe(false)
  expect(camera.getAttribute('accept')).toBe('image/jpeg,image/png,image/webp')
  const gallery = screen.getByLabelText('Upload solution pages')
  expect(gallery.hasAttribute('capture')).toBe(false)
  expect(gallery.multiple).toBe(true)

  const shot = new File(['photo'], 'image.jpg', { type: 'image/jpeg' })
  fireEvent.change(camera, { target: { files: [shot] } })
  expect(await screen.findByText('1 / 4 pages')).toBeTruthy()
  expect(uploadSolutionImage.mock.calls[0][1]).toBe(shot)
  vi.unstubAllGlobals()
})

test('a desktop keeps one photo button and no camera input', async () => {
  touchScreen(false)
  workspace([question([{ id: 'q1-a', label: '(a)', marks: 2, prompt: [paragraph('Solve x + 2 = 7.')] }], { capabilities: withUploads() })])
  await openAnswer()
  expect(await screen.findByRole('button', { name: 'Add photo of working' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Take photo' })).toBeNull()
  expect(screen.queryByLabelText('Take a photo of your working')).toBeNull()
  vi.unstubAllGlobals()
})
