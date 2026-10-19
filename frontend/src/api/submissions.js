import { uploadMultipart } from './uploadTransport.js'

const API_BASE_URL = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '')
const API_PREFIX = '/api/v1'
const REQUEST_TIMEOUT_MS = 15000
const SESSION_STORAGE_KEY = 'ai-tutor-learner-session-v1'
const GUEST_STORAGE_KEY = 'math-mate-guest-session-v1'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let sessionPromise = null
let guestPromise = null

async function responseError(response) {
  let message = `Request failed (${response.status})`
  try {
    const body = await response.json()
    if (typeof body.detail === 'string') message = body.detail
  } catch { /* Keep the status-based message for non-JSON errors. */ }
  const error = new Error(message)
  error.status = response.status
  return error
}

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
    if (!response.ok) throw await responseError(response)
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

function forgetGuest(token) {
  try {
    const stored = JSON.parse(localStorage.getItem(GUEST_STORAGE_KEY) || 'null')
    if (stored?.access_token === token) localStorage.removeItem(GUEST_STORAGE_KEY)
  } catch { /* Nothing stored to forget. */ }
}

async function guestRequest(path, options = {}) {
  const send = (token) => apiRequest(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } })
  const token = await guestToken()
  try {
    return await send(token)
  } catch (error) {
    if (error.status !== 401) throw error
    // MVP: guest identities are disposable until student login arrives. A token the
    // server does not know (expired, or another database via MATH_MATE_DB) is
    // replaced by a new guest once; work saved under the old token stays there.
    forgetGuest(token)
    return send(await guestToken())
  }
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

export async function getTutorReviews(topicNumber) {
  const data = await guestRequest(`/me/assessments?topic_number=${encodeURIComponent(topicNumber)}`)
  return data.assessments
}

// Submits the saved revision and waits for AI marking, so no polling is needed.
// If the connection drops first, marking still finishes and getTutorReviews shows it.
export function requestTutorReview(questionPartId, expectedRevision) {
  return guestRequest(`/me/responses/${encodeURIComponent(questionPartId)}/assessments?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_revision: expectedRevision }),
    timeoutMs: 120000,
  })
}

export async function getTutorChatTurns(topicNumber) {
  const data = await guestRequest(`/me/tutor-turns?topic_number=${encodeURIComponent(topicNumber)}`)
  return data.turns
}

function parseServerEvent(block) {
  let type = 'message'
  const data = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (!data.length) return null
  try { return { type, data: JSON.parse(data.join('\n')) } }
  catch { return null }
}

// Streams the tutor reply. onEvent receives start, delta, reset, done and error events as they arrive.
// The server saves the turn even if this connection drops, so callers can recover by polling.
export async function sendTutorChatMessage(questionPartId, message, clientMessageId, { intent = 'message', onEvent, signal } = {}) {
  signal?.throwIfAborted()
  const token = await guestToken()
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 60000)
  try {
    const response = await fetch(`${API_BASE_URL}${API_PREFIX}/me/question-parts/${encodeURIComponent(questionPartId)}/tutor-turns`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream, application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ client_message_id: clientMessageId, message, intent }),
      signal: controller.signal,
    })
    if (!response.ok) throw await responseError(response)
    // A retry of an already answered message returns the saved turn as JSON.
    if (!response.headers.get('content-type')?.includes('text/event-stream')) return await response.json()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = parseServerEvent(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (!event) continue
        onEvent?.(event)
        if (event.type === 'done') return event.data
        if (event.type === 'error') {
          const error = new Error(event.data.error_message || 'The tutor could not answer just now.')
          error.turn = event.data
          throw error
        }
      }
    }
    throw new Error('The connection closed early. Checking for your saved reply; please wait before retrying.')
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Request stopped', 'AbortError')
    if (error.name === 'AbortError') throw new Error('The connection took too long. Checking for your saved result; please wait before retrying.')
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}
