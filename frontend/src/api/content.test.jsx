import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

test('startup prefetch shares the topic request with later navigation', async () => {
  const fetchMock = vi.fn(async (url) => new Response(JSON.stringify(
    url.endsWith('/questions/summary')
      ? { topic_counts: { 2: 181 }, subtopic_counts: {} }
      : { questions: [{ id: 'question-one' }] },
  ), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)

  const { getQuestionBank, getQuestionSummary, preloadQuestionContent } = await import('./content.js')
  preloadQuestionContent()
  expect(fetchMock.mock.calls.map(([url]) => url.slice(url.indexOf('/api/v1')))).toEqual([
    '/api/v1/topics/2/questions',
    '/api/v1/questions/summary',
  ])

  expect((await getQuestionBank('2')).questions).toHaveLength(1)
  expect((await getQuestionSummary()).topic_counts['2']).toBe(181)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
