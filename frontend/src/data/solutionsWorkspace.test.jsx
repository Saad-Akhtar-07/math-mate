// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import QuestionPracticePage from '../pages/QuestionPracticePage.jsx'
import { getStudentResponse, getStudentResponses, saveStudentResponse, submitStudentResponse, getTutorReviews, getTutorChatTurns, getResponseSubmissions, uploadSolutionImage, removeSolutionImage, getSolutionImageUrl } from '../api/submissions.js'

vi.mock('../api/content.js', () => ({
  getQuestionBank: vi.fn(async () => ({ questions: [{
    id: 'q1', title: 'Solve an equation', number: 1, prompt: [], total_marks: 2,
    localDraftOnly: false,
    capabilities: { saveResponses: true, submitResponses: true, uploads: true, aiTutor: false },
    parts: [{ id: 'q1-a', label: '(a)', prompt: [], marks: 2 }],
  }] })),
  getQuestionPartSolution: vi.fn(),
}))
vi.mock('../api/submissions.js', async (original) => ({
  ...await original(),
  getStudentResponse: vi.fn(), getStudentResponses: vi.fn(), saveStudentResponse: vi.fn(), submitStudentResponse: vi.fn(),
  getTutorReviews: vi.fn(), getTutorChatTurns: vi.fn(), getResponseSubmissions: vi.fn(),
  uploadSolutionImage: vi.fn(), removeSolutionImage: vi.fn(), getSolutionImageUrl: vi.fn(),
}))
vi.mock('../api/uploadTransport.js', async (original) => ({
  ...await original(), fileFingerprint: vi.fn(async (file) => `hash:${file.name}`),
}))

let savedPages, savedText, revision

function workspace() {
  return render(<MemoryRouter initialEntries={['/topic/2/practice']}><Routes>
    <Route path="/topic/:topicNumber/practice" element={<QuestionPracticePage />} />
  </Routes></MemoryRouter>)
}
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollIntoView = vi.fn()
  getStudentResponses.mockResolvedValue([])
  savedPages = []; savedText = null; revision = 0
  getStudentResponse.mockImplementation(async (partId) => ({ question_part_id: partId,
    typed_work: savedText, revision, attachments: savedPages, submitted: false }))
  saveStudentResponse.mockImplementation(async (partId, text, expected) => {
    if (savedText !== text) revision = expected + 1
    savedText = text
    return { question_part_id: partId, typed_work: text, revision, attachments: savedPages, submitted: false }
  })
  uploadSolutionImage.mockImplementation(async (partId, file, expected) => {
    revision = expected + 1
    savedPages = [...savedPages, { id: file.name, file_id: file.name, original_filename: file.name, position: savedPages.length + 1, byte_size: 20480, upload_sha256: `hash:${file.name}` }]
    return { question_part_id: partId, typed_work: savedText, revision, attachments: savedPages, submitted: false }
  })
  removeSolutionImage.mockImplementation(async (partId, id, expected) => {
    revision = expected + 1
    savedPages = savedPages.filter((page) => page.id !== id).map((page, index) => ({ ...page, position: index + 1 }))
    return { question_part_id: partId, typed_work: savedText, revision, attachments: savedPages, submitted: false }
  })
  getSolutionImageUrl.mockResolvedValue({ url: 'https://storage.example.test/page.jpg' })
  submitStudentResponse.mockResolvedValue({ id: 'submitted-1' })
  getResponseSubmissions.mockResolvedValue({ submissions: [{ id: 'submitted-1', typed_work: 'x = 5', submitted_at: '2026-10-16T12:00:00Z' }], next_cursor: null })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('guest saves, submits, views history and edits a new draft without AI requests', async () => {
  workspace()
  const answer = await screen.findByRole('textbox', { name: 'Your working and answer' })
  await waitFor(() => expect(answer.disabled).toBe(false))
  expect(screen.getByRole('button', { name: 'Check with AI' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Add solution photo' }).disabled).toBe(false)
  fireEvent.change(answer, { target: { value: 'x = 5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
  await screen.findByRole('button', { name: 'Submitted' })
  expect(saveStudentResponse).toHaveBeenCalledWith('q1-a', 'x = 5', 0)
  expect(submitStudentResponse).toHaveBeenCalledWith('q1-a', 1)
  fireEvent.click(screen.getByRole('button', { name: 'View submitted answers' }))
  expect(await screen.findByText('x = 5', { selector: 'pre' })).toBeTruthy()
  fireEvent.change(answer, { target: { value: 'x = 6' } })
  expect(screen.getByRole('button', { name: 'Submit answer' }).disabled).toBe(false)
  expect(JSON.parse(localStorage.getItem('math-mate-drafts-v1'))['2']['q1-a']).toBe('x = 6')
  expect(getTutorReviews).not.toHaveBeenCalled()
  expect(getTutorChatTurns).not.toHaveBeenCalled()
})

test('different local recovery and server answers require an explicit choice', async () => {
  localStorage.setItem('math-mate-drafts-v1', JSON.stringify({ 2: { 'q1-a': 'Local work' } }))
  getStudentResponses.mockResolvedValue([{ question_part_id: 'q1-a', typed_work: 'Server work', revision: 4, attachments: [], submitted: true }])
  workspace()
  await screen.findByRole('region', { name: 'Choose saved answer' })
  expect(saveStudentResponse).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save my local draft instead' }))
  await waitFor(() => expect(saveStudentResponse).toHaveBeenCalledWith('q1-a', 'Local work', 4))
})

test('failed restoration prevents accidentally overwriting saved work', async () => {
  getStudentResponses.mockRejectedValue(new Error('Server unavailable'))
  workspace()
  await screen.findByRole('alert')
  expect(screen.getByRole('textbox', { name: 'Your working and answer' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Save work' }).disabled).toBe(true)
  expect(saveStudentResponse).not.toHaveBeenCalled()
})

test('an interrupted server save keeps the typed answer for recovery after reopening', async () => {
  saveStudentResponse.mockRejectedValue(new Error('Connection interrupted'))
  workspace()
  const answer = await screen.findByRole('textbox', { name: 'Your working and answer' })
  await waitFor(() => expect(answer.disabled).toBe(false))
  fireEvent.change(answer, { target: { value: 'Keep this working' } })
  await screen.findByText('Connection interrupted', {}, { timeout: 2000 })
  expect(JSON.parse(localStorage.getItem('math-mate-drafts-v1'))['2']['q1-a']).toBe('Keep this working')
  cleanup()
  saveStudentResponse.mockResolvedValue({ question_part_id: 'q1-a', typed_work: 'Keep this working', revision: 1, attachments: [] })
  workspace()
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Your working and answer' }).value).toBe('Keep this working'))
  await waitFor(() => expect(saveStudentResponse).toHaveBeenLastCalledWith('q1-a', 'Keep this working', 0))
})

test('two uploaded pages stay separate and image-only work can be submitted', async () => {
  workspace()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add solution photo' }).disabled).toBe(false))
  expect(screen.getByRole('button', { name: 'Submit answer' }).disabled).toBe(true)
  const first = new File(['page one'], 'first.jpg', { type: 'image/jpeg' })
  const second = new File(['page two'], 'second.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Upload solution pages'), { target: { files: [first, second] } })
  await screen.findByText('2 solution pages saved')
  expect(uploadSolutionImage).toHaveBeenNthCalledWith(1, 'q1-a', first, 1, expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }))
  expect(uploadSolutionImage).toHaveBeenNthCalledWith(2, 'q1-a', second, 2, expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }))
  expect(screen.getByRole('button', { name: 'Submit answer' }).disabled).toBe(false)
  getResponseSubmissions.mockResolvedValue({ submissions: [{ id: 'attempt', typed_work: '', submitted_at: '2026-10-16T12:00:00Z', attachments: savedPages }], next_cursor: null })
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
  await screen.findByRole('button', { name: 'Submitted' })
  expect(submitStudentResponse).toHaveBeenCalledWith('q1-a', 3)
  fireEvent.click(screen.getByRole('button', { name: 'Remove first.jpg' }))
  await screen.findByText('Page removed from this draft. Submitted answers keep their pages.')
  expect(removeSolutionImage).toHaveBeenCalledWith('q1-a', 'first.jpg', 3)
  expect(screen.getByRole('button', { name: 'Submit answer' }).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'View submitted answers' }))
  const historical = await screen.findByLabelText('Submitted solution pages')
  expect(historical.querySelectorAll('figure')).toHaveLength(2)
})

test('more than four pages are rejected before any upload starts', async () => {
  workspace()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add solution photo' }).disabled).toBe(false))
  const files = Array.from({ length: 5 }, (_, index) => new File(['page'], `${index}.jpg`, { type: 'image/jpeg' }))
  fireEvent.change(screen.getByLabelText('Upload solution pages'), { target: { files } })
  await screen.findByText('You can attach up to 4 pages to one answer.')
  expect(uploadSolutionImage).not.toHaveBeenCalled()
  expect(saveStudentResponse).not.toHaveBeenCalled()
})

test('a partially failed batch still shows the page already saved', async () => {
  uploadSolutionImage.mockImplementationOnce(async () => {
    savedPages = [{ id: 'a', file_id: 'a', position: 1, original_filename: 'first.jpg', byte_size: 1000 }]
    revision = 2
    return { revision, attachments: savedPages }
  }).mockRejectedValueOnce(new Error('Storage quota reached'))
  workspace()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add solution photo' }).disabled).toBe(false))
  fireEvent.change(screen.getByLabelText('Upload solution pages'), { target: { files: [
    new File(['one'], 'first.jpg', { type: 'image/jpeg' }), new File(['two'], 'second.jpg', { type: 'image/jpeg' }),
  ] } })
  await screen.findByText('Storage quota reached')
  expect(screen.getByRole('button', { name: 'Remove first.jpg' })).toBeTruthy()
  expect(screen.getByText(/1 \/ 4 pages/)).toBeTruthy()
})

const photo = (name) => new File([name], name, { type: 'image/jpeg' })
async function selectPhotos(files) {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add solution photo' }).disabled).toBe(false))
  fireEvent.change(screen.getByLabelText('Upload solution pages'), { target: { files } })
}

test('shows transfer percentage then saving, and cannot submit until confirmation', async () => {
  let finish, progress
  uploadSolutionImage.mockImplementationOnce((partId, file, expected, options) => {
    progress = options.onProgress
    return new Promise((resolve) => { finish = () => resolve({ revision: expected + 1, attachments: [{ id: file.name, file_id: file.name, original_filename: file.name, position: 1 }] }) })
  })
  workspace()
  await selectPhotos([photo('steps.jpg')])
  await waitFor(() => expect(progress).toBeTypeOf('function'))
  progress({ phase: 'uploading', percent: 42 })
  await screen.findByText('Uploading 42%')
  expect(screen.getByRole('progressbar').value).toBe(42)
  expect(screen.getByRole('button', { name: 'Submit answer' }).disabled).toBe(true)
  progress({ phase: 'saving', percent: null })
  await screen.findByText('Saving photo…')
  expect(screen.getByRole('button', { name: 'Submit answer' }).disabled).toBe(true)
  finish()
  await screen.findByText('1 of 1 photo saved')
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.getByRole('button', { name: 'Submit answer' }).disabled).toBe(false)
})

test('retry remaining sends only failed and waiting photos with their original files', async () => {
  const normalUpload = uploadSolutionImage.getMockImplementation()
  uploadSolutionImage.mockImplementationOnce(normalUpload).mockRejectedValueOnce(new Error('Connection unavailable'))
  workspace()
  const files = [photo('first.jpg'), photo('second.jpg'), photo('third.jpg')]
  await selectPhotos(files)
  await screen.findByText('Connection unavailable')
  expect(screen.getByText('1 of 3 photos saved')).toBeTruthy()
  expect(uploadSolutionImage).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: 'Submit answer' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Retry remaining photos' }))
  await screen.findByText('3 of 3 photos saved')
  expect(uploadSolutionImage.mock.calls.map((call) => call[1])).toEqual([files[0], files[1], files[1], files[2]])
  expect(uploadSolutionImage.mock.calls.map((call) => call[2])).toEqual([1, 2, 2, 3])
  expect(screen.getByText('3 / 4 pages')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Submit answer' }).disabled).toBe(false)
  expect(screen.queryByText(/compressed|KB/)).toBeNull()
})

test('a lost success confirmation checks saved pages without uploading again', async () => {
  const normalUpload = uploadSolutionImage.getMockImplementation()
  uploadSolutionImage.mockImplementationOnce(async (...args) => {
    await normalUpload(...args)
    throw Object.assign(new Error('Connection interrupted'), { uncertain: true })
  })
  workspace()
  await selectPhotos([photo('saved.jpg')])
  await screen.findByText('1 of 1 photo saved')
  expect(getStudentResponse).toHaveBeenCalledTimes(1)
  expect(uploadSolutionImage).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: 'Retry saved.jpg' })).toBeNull()
  expect(screen.getByText('1 / 4 pages')).toBeTruthy()
})

test('an uncertain upload is retained when offline and retry confirms the saved copy', async () => {
  const normalUpload = uploadSolutionImage.getMockImplementation()
  uploadSolutionImage.mockImplementationOnce(async (...args) => {
    await normalUpload(...args)
    throw Object.assign(new Error('Connection interrupted'), { uncertain: true })
  })
  getStudentResponse.mockRejectedValueOnce(new Error('Still offline'))
  workspace()
  await selectPhotos([photo('saved.jpg')])
  await screen.findByText('Retry to confirm whether this photo was saved.')
  expect(screen.queryByRole('button', { name: 'Remove selected saved.jpg' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry saved.jpg' }))
  await screen.findByText('1 of 1 photo saved')
  expect(uploadSolutionImage).toHaveBeenCalledTimes(1)
  expect(getStudentResponse).toHaveBeenCalledTimes(2)
})

test('invalid photos can be removed and remaining valid pages uploaded', async () => {
  uploadSolutionImage.mockRejectedValueOnce(Object.assign(new Error('This photo cannot be read. Choose another image.'), { status: 422 }))
  workspace()
  await selectPhotos([photo('broken.jpg'), photo('valid.jpg')])
  await screen.findByText('This photo cannot be read. Choose another image.')
  expect(screen.queryByRole('button', { name: 'Retry broken.jpg' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Remove selected broken.jpg' }))
  fireEvent.click(screen.getByRole('button', { name: 'Upload remaining photo' }))
  await screen.findByText('1 of 1 photo saved')
  expect(uploadSolutionImage).toHaveBeenCalledTimes(2)
  expect(uploadSolutionImage.mock.calls[1][1].name).toBe('valid.jpg')
})

test('rapid retry clicks start only one request and waiting photos reserve the four-page limit', async () => {
  let finish
  const normalUpload = uploadSolutionImage.getMockImplementation()
  uploadSolutionImage.mockRejectedValueOnce(new Error('Try again')).mockImplementationOnce((...args) =>
    new Promise((resolve) => { finish = async () => resolve(await normalUpload(...args)) }))
  workspace()
  await selectPhotos([photo('first.jpg'), photo('second.jpg'), photo('third.jpg'), photo('fourth.jpg')])
  await screen.findByText('Try again')
  expect(screen.getByRole('button', { name: 'Add solution photo' }).disabled).toBe(true)
  const retry = screen.getByRole('button', { name: 'Retry first.jpg' })
  fireEvent.click(retry)
  fireEvent.click(retry)
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(uploadSolutionImage).toHaveBeenCalledTimes(2)
  await finish()
  await screen.findByText('1 of 4 photos saved')
  expect(uploadSolutionImage).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: 'Retry remaining photos' }))
  await screen.findByText('4 of 4 photos saved')
  expect(uploadSolutionImage).toHaveBeenCalledTimes(5)
})

test('unmount aborts an active upload and never sends the remaining files', async () => {
  let signal, finish
  uploadSolutionImage.mockImplementationOnce((partId, file, expected, options) => {
    signal = options.signal
    return new Promise((resolve) => { finish = () => resolve({ revision: 2, attachments: [] }) })
  })
  const view = workspace()
  await selectPhotos([photo('first.jpg'), photo('second.jpg')])
  await waitFor(() => expect(signal).toBeTruthy())
  view.unmount()
  expect(signal.aborted).toBe(true)
  finish()
  await Promise.resolve()
  await Promise.resolve()
  expect(uploadSolutionImage).toHaveBeenCalledTimes(1)
})

test('unfinished photos warn before reload and removing them releases previews and stale errors', async () => {
  const revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:selected-photo' }
    static revokeObjectURL(value) { revoke(value) }
  })
  uploadSolutionImage.mockRejectedValueOnce(new Error('Upload unavailable'))
  workspace()
  await selectPhotos([photo('steps.jpg')])
  await screen.findByText('Upload unavailable')
  const leaving = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(leaving)
  expect(leaving.defaultPrevented).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Remove selected steps.jpg' }))
  expect(revoke).toHaveBeenCalledWith('blob:selected-photo')
  expect(screen.queryByText('Upload unavailable')).toBeNull()
  const afterRemoval = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(afterRemoval)
  expect(afterRemoval.defaultPrevented).toBe(false)
})

test('when saving typed work fails, retry saves it first before uploading any photo', async () => {
  saveStudentResponse.mockRejectedValueOnce(new Error('Your work could not be saved'))
  workspace()
  await selectPhotos([photo('steps.jpg')])
  await screen.findByText('Your work could not be saved')
  expect(uploadSolutionImage).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry steps.jpg' }))
  await screen.findByText('1 of 1 photo saved')
  expect(saveStudentResponse).toHaveBeenCalledTimes(2)
  expect(uploadSolutionImage).toHaveBeenCalledTimes(1)
  expect(uploadSolutionImage.mock.calls[0][2]).toBe(1)
})

test('revision conflicts block retry until the saved answer is chosen', async () => {
  uploadSolutionImage.mockRejectedValueOnce(Object.assign(new Error('Answer changed in another tab'), { status: 409 }))
  getStudentResponse.mockResolvedValue({ question_part_id: 'q1-a', typed_work: 'Other tab answer', revision: 4, attachments: [] })
  workspace()
  await selectPhotos([photo('steps.jpg')])
  await screen.findByRole('region', { name: 'Choose saved answer' })
  expect(screen.getByRole('button', { name: 'Retry steps.jpg' }).disabled).toBe(true)
  expect(uploadSolutionImage).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Use saved answer' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry steps.jpg' }).disabled).toBe(false))
  // The fake backend now reflects the explicitly adopted remote revision.
  savedText = 'Other tab answer'; revision = 4
  fireEvent.click(screen.getByRole('button', { name: 'Retry steps.jpg' }))
  await screen.findByText('1 of 1 photo saved')
  expect(uploadSolutionImage.mock.calls[1][2]).toBe(4)
  expect(screen.getByRole('textbox', { name: 'Your working and answer' }).value).toBe('Other tab answer')
})

test('a duplicate upload response cannot silently adopt another tab’s changed text', async () => {
  uploadSolutionImage.mockResolvedValueOnce({ revision: 4, typed_work: 'Other tab answer', attachments: [] })
  workspace()
  const answer = await screen.findByRole('textbox', { name: 'Your working and answer' })
  await waitFor(() => expect(answer.disabled).toBe(false))
  fireEvent.change(answer, { target: { value: 'My local answer' } })
  getStudentResponses.mockResolvedValue([{ question_part_id: 'q1-a', typed_work: 'Other tab answer', revision: 4, attachments: [] }])
  getStudentResponse.mockResolvedValue({ question_part_id: 'q1-a', typed_work: 'Other tab answer', revision: 4, attachments: [] })
  fireEvent.change(screen.getByLabelText('Upload solution pages'), { target: { files: [new File(['photo'], 'first.jpg', { type: 'image/jpeg' })] } })
  await screen.findByRole('region', { name: 'Choose saved answer' })
  expect(answer.value).toBe('My local answer')
  fireEvent.click(screen.getByRole('button', { name: 'Save my local draft instead' }))
  await waitFor(() => expect(saveStudentResponse).toHaveBeenLastCalledWith('q1-a', 'My local answer', 4))
})
