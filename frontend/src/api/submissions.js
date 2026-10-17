import { uploadMultipart } from './uploadTransport.js'

const API_BASE_URL = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '')
const API_PREFIX = '/api/v1'
const REQUEST_TIMEOUT_MS = 15000
const SESSION_STORAGE_KEY = 'ai-tutor-learner-session-v1'
const GUEST_STORAGE_KEY = 'math-mate-guest-session-v1'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let sessionPromise = null
let guestPromise = null

async function apiRequest(path, options = {}) {
  const { timeoutMs = REQUEST_TIMEOUT_MS, signal: externalSignal, ...fetchOptions } = options
  externalSignal?.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort()
  externalSignal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      ...fetchOptions,
      headers: {
        Accept: 'application/json',
        ...fetchOptions.headers,
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      let message = `Request failed (${response.status})`
      try {
        const body = await response.json()
        if (typeof body.detail === 'string') message = body.detail
      } catch { /* Keep the status-based message for non-JSON errors. */ }
      const error = new Error(message)
      error.status = response.status
      throw error
    }
    if (response.status === 204) return null
    return await response.json()
  } catch (error) {
    if (externalSignal?.aborted) throw new DOMException('Request stopped', 'AbortError')
    if (error.name === 'AbortError') throw new Error('The connection took too long. Checking for your saved result; please wait before retrying.')
    throw error
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abort)
  }
}

function storedSessionId() {
  try {
    const value = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!value || UUID_PATTERN.test(value)) return value
    localStorage.removeItem(SESSION_STORAGE_KEY)
    return null
  }
  catch { return null }
}

function rememberSession(id) {
  try { localStorage.setItem(SESSION_STORAGE_KEY, id) }
  catch { /* The session remains usable until this tab is closed. */ }
}

function forgetSession() {
  try { localStorage.removeItem(SESSION_STORAGE_KEY) }
  catch { /* Nothing else to clean up. */ }
}

async function createSession() {
  const session = await apiRequest('/learner-sessions', { method: 'POST' })
  rememberSession(session.id)
  return session.id
}

export async function getSessionId() {
  const existing = storedSessionId()
  if (existing) return existing
  if (!sessionPromise) sessionPromise = createSession().finally(() => { sessionPromise = null })
  return sessionPromise
}

async function withSession(operation, canRetry = true) {
  const sessionId = await getSessionId()
  try {
    return await operation(sessionId)
  } catch (error) {
    if (canRetry && error.status === 404 && error.message === 'Learner session not found') {
      forgetSession()
      sessionPromise = null
      return withSession(operation, false)
    }
    throw error
  }
}

export function getStudentResponses(topicNumber) {
  return (async () => {
    const responses = []
    let cursor = ''
    do {
      const data = await guestRequest(`/me/responses?topic_number=${encodeURIComponent(topicNumber)}&after=${encodeURIComponent(cursor)}`)
      responses.push(...data.responses)
      cursor = data.next_cursor
    } while (cursor)
    return responses
  })()
}

export function getStudentResponse(partId, options = {}) {
  return guestRequest(`/me/responses/${encodeURIComponent(partId)}`, options)
}

export function saveStudentResponse(questionPartId, typedWork, expectedRevision = 0) {
  return guestRequest(
    `/me/responses/${encodeURIComponent(questionPartId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typed_work: typedWork, expected_revision: expectedRevision }),
    },
  )
}

async function guestToken() {
  const readToken = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(GUEST_STORAGE_KEY) || 'null')
      if (stored?.access_token && Date.parse(stored.expires_at) > Date.now()) return stored.access_token
    } catch { /* Create a fresh guest below. */ }
    return null
  }
  const existing = readToken()
  if (existing) return existing
  if (!guestPromise) {
    const create = async () => {
      // Another tab may have established this browser's identity while waiting.
      const established = readToken()
      if (established) return established
      const session = await apiRequest('/learner-sessions', { method: 'POST' })
      // Persist before accepting work: otherwise a refresh would lose access.
      localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(session))
      return session.access_token
    }
    const locks = globalThis.navigator?.locks
    guestPromise = (locks ? locks.request(GUEST_STORAGE_KEY, create) : create())
      .finally(() => { guestPromise = null })
  }
  return guestPromise
}

async function guestRequest(path, options = {}) {
  const token = await guestToken()
  // Never silently replace an invalid identity and send existing work to it.
  return apiRequest(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } })
}

export function submitStudentResponse(partId, expectedRevision) {
  return guestRequest(`/me/responses/${encodeURIComponent(partId)}/submissions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_revision: expectedRevision }),
  })
}

export function getResponseSubmissions(partId, before = '') {
  return guestRequest(`/me/responses/${encodeURIComponent(partId)}/submissions${before ? `?before=${before}` : ''}`)
}

export async function uploadSolutionImage(questionPartId, file, expectedRevision, options = {}) {
  options.signal?.throwIfAborted()
  const token = await guestToken()
  options.signal?.throwIfAborted()
  const form = new FormData()
  form.append('image', file)
  form.append('expected_revision', String(expectedRevision))
  return uploadMultipart(`${API_BASE_URL}${API_PREFIX}/me/responses/${encodeURIComponent(questionPartId)}/attachments`, {
    body: form, headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: options.signal, onProgress: options.onProgress,
  })
}

export function removeSolutionImage(partId, attachmentId, expectedRevision) {
  return guestRequest(
    `/me/responses/${encodeURIComponent(partId)}/attachments/${encodeURIComponent(attachmentId)}?expected_revision=${expectedRevision}`,
    { method: 'DELETE' },
  )
}

export function getSolutionImageUrl(fileId) {
  return guestRequest(`/me/solution-files/${encodeURIComponent(fileId)}/url`)
}

export function attachmentContentUrl(contentUrl) {
  return `${API_BASE_URL}${contentUrl}`
}

export function getTutorReviews(topicNumber) {
  return withSession(async (sessionId) => {
    const data = await apiRequest(
      `/learner-sessions/${sessionId}/reviews?topic_number=${encodeURIComponent(topicNumber)}`,
    )
    return data.reviews
  })
}

export function requestTutorReview(questionPartId, expectedRevision, intent = 'check') {
  return withSession((sessionId) => apiRequest(
    `/learner-sessions/${sessionId}/responses/${encodeURIComponent(questionPartId)}/reviews`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_revision: expectedRevision, intent }),
      timeoutMs: 95000,
    },
  ))
}

export function getTutorChatTurns(topicNumber) {
  return withSession(async (sessionId) => {
    const data = await apiRequest(
      `/learner-sessions/${sessionId}/chat-turns?topic_number=${encodeURIComponent(topicNumber)}`,
    )
    return data.turns
  })
}

export function sendTutorChatMessage(questionPartId, message, clientMessageId) {
  return withSession((sessionId) => apiRequest(
    `/learner-sessions/${sessionId}/question-parts/${encodeURIComponent(questionPartId)}/chat-turns`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_message_id: clientMessageId, message }),
      timeoutMs: 60000,
    },
  ))
}
