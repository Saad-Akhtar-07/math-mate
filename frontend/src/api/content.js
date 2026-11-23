const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const API_PREFIX = '/api/v1'
// Render's free web service can take about a minute to wake after idle.
const REQUEST_TIMEOUT_MS = import.meta.env.PROD ? 90000 : 10000

const questionBankCache = new Map()
const questionDetailCache = new Map()
const questionSummaryCache = new Map()

async function fetchContent(path) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Content API request failed (${response.status})`)
    return response.json()
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Content API request timed out')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function cachedFetch(cache, key, path) {
  if (!cache.has(key)) {
    const request = fetchContent(path).catch((error) => {
      cache.delete(key)
      throw error
    })
    cache.set(key, request)
  }
  return cache.get(key)
}

export function getQuestionBank(topicNumber) {
  const key = String(topicNumber)
  return cachedFetch(questionBankCache, key, `/topics/${encodeURIComponent(key)}/questions/catalogue`)
}

export function getQuestionDetail(questionId) {
  const key = String(questionId)
  return cachedFetch(questionDetailCache, key, `/questions/${encodeURIComponent(key)}`)
}

export function getQuestionPartSolution(questionPartId) {
  return fetchContent(`/question-parts/${encodeURIComponent(questionPartId)}/solution`)
}

export function getQuestionSummary() {
  return cachedFetch(questionSummaryCache, 'all', '/questions/summary')
}

export function preloadQuestionContent() {
  // Startup needs only the tiny count summary. A topic catalogue is fetched
  // when the learner opens it; complete question content is fetched per question.
  void getQuestionSummary().catch(() => {})
}
