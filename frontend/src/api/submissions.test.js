import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { getTutorReviews, requestTutorReview, sendTutorChatMessage } from './submissions.js'

const originalFetch = globalThis.fetch
const clientId = '22345678-1234-4234-8234-123456789abc'
const guest = JSON.stringify({ access_token: 'guest-token', expires_at: '2999-01-01T00:00:00Z' })
beforeEach(() => {
  globalThis.localStorage = { getItem: () => guest, setItem: () => {}, removeItem: () => {} }
})
afterEach(() => { globalThis.fetch = originalFetch; delete globalThis.localStorage })

function eventStream(blocks) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(block))
      controller.close()
    },
  }), { headers: { 'content-type': 'text/event-stream' } })
}

test('a manual retry sends the same message id, intent and guest token', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ status: 'completed', client_message_id: clientId }), { headers: { 'content-type': 'application/json' } })
  }
  await sendTutorChatMessage('part-1', 'Help me', clientId, { intent: 'hint' })
  const result = await sendTutorChatMessage('part-1', 'Help me', clientId, { intent: 'hint' })
  assert.equal(result.status, 'completed')
  assert.equal(requests[0].options.body, requests[1].options.body)
  assert.deepEqual(JSON.parse(requests[0].options.body), { client_message_id: clientId, message: 'Help me', intent: 'hint' })
  assert.ok(requests[0].url.endsWith('/api/v1/me/question-parts/part-1/tutor-turns'))
  assert.equal(requests[0].options.headers.Authorization, 'Bearer guest-token')
  assert.match(requests[0].options.headers.Accept, /text\/event-stream/)
})

test('streamed events arrive in order, including events split across chunks', async () => {
  const events = []
  globalThis.fetch = async () => eventStream([
    'event: start\ndata: {"teaching_move":"small_hint","status":"processing"}\n\n',
    'event: delta\ndata: {"text":"Check line 2."}\n\nevent: del',
    'ta\ndata: {"text":" What sign?"}\n\n',
    'event: done\ndata: {"status":"completed","tutor_message":"Check line 2. What sign?"}\n\n',
  ])
  const turn = await sendTutorChatMessage('part', 'Help', clientId, { onEvent: (event) => events.push(event) })
  assert.equal(turn.tutor_message, 'Check line 2. What sign?')
  assert.deepEqual(events.map((event) => event.type), ['start', 'delta', 'delta', 'done'])
  assert.equal(events.filter((event) => event.type === 'delta').map((event) => event.data.text).join(''), 'Check line 2. What sign?')
})

test('an error event rejects with the saved failed turn attached', async () => {
  globalThis.fetch = async () => eventStream([
    'event: start\ndata: {"status":"processing"}\n\n',
    'event: error\ndata: {"status":"failed","error_message":"The tutor took too long to respond.","can_retry":true}\n\n',
  ])
  await assert.rejects(sendTutorChatMessage('part', 'Help', clientId), (error) => {
    assert.match(error.message, /took too long/)
    assert.equal(error.turn.can_retry, true)
    return true
  })
})

test('a stream that closes without a result asks the page to check for the saved reply', async () => {
  globalThis.fetch = async () => eventStream(['event: start\ndata: {"status":"processing"}\n\n'])
  await assert.rejects(sendTutorChatMessage('part', 'Help', clientId), /Checking for your saved reply/)
})

test('non-JSON gateway failures remain readable and are not resubmitted', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response('<html>Unavailable</html>', { status: 503 }) }
  await assert.rejects(sendTutorChatMessage('part', 'Help', clientId), /Request failed \(503\)/)
  assert.equal(calls, 1)
})

test('timeout also covers reading the stream', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  globalThis.fetch = async (_, options) => ({
    ok: true, status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: { getReader: () => ({ read: () => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }) }) },
  })
  const pending = sendTutorChatMessage('part', 'Help', clientId)
  const checked = assert.rejects(pending, /Checking for your saved result/)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  t.mock.timers.tick(60000)
  await checked
})

test('marking requests and results use the guest token', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify(url.includes('/assessments?') ? { assessments: [] } : { id: 'a1', status: 'pending' }))
  }
  assert.deepEqual(await getTutorReviews('2'), [])
  assert.equal((await requestTutorReview('part-1', 3)).status, 'pending')
  assert.ok(requests[0].url.endsWith('/api/v1/me/assessments?topic_number=2'))
  assert.ok(requests[1].url.endsWith('/api/v1/me/responses/part-1/assessments'))
  assert.deepEqual(JSON.parse(requests[1].options.body), { expected_revision: 3 })
  assert.ok(requests.every((request) => request.options.headers.Authorization === 'Bearer guest-token'))
})
