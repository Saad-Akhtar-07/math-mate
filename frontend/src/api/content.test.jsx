import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

test('startup prefetch loads only the small summary', async () => {
  const response = (body) => new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  })
  const fetchMock = vi.fn((url) => {
    if (url.endsWith('/questions/summary')) {
      return Promise.resolve(response({ topic_counts: { 1: 12, 2: 181 }, subtopic_counts: {} }))
    }
    return Promise.resolve(response({ questions: [{ id: 'question-one' }] }))
  })
  vi.stubGlobal('fetch', fetchMock)

  const { getQuestionBank, getQuestionSummary, preloadQuestionContent } = await import('./content.js')
  preloadQuestionContent()
  expect(fetchMock.mock.calls.map(([url]) => url.slice(url.indexOf('/api/v1')))).toEqual([
    '/api/v1/questions/summary',
  ])

  await getQuestionSummary()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const topicTwo = getQuestionBank('2')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls[1][0]).toContain('/api/v1/topics/2/questions/catalogue')

  expect((await topicTwo).questions).toHaveLength(1)
  expect((await getQuestionSummary()).topic_counts['2']).toBe(181)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
