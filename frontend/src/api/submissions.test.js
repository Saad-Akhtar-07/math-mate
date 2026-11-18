import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { getTutorReviews, requestTutorReview, sendTutorChatMessage } from './submissions.js'
import { setAccessTokenProviderForTests } from '../auth/supabase.js'

const originalFetch = globalThis.fetch
const clientId = '22345678-1234-4234-8234-123456789abc'
beforeEach(() => setAccessTokenProviderForTests(async () => 'account-token'))
afterEach(() => { globalThis.fetch = originalFetch; setAccessTokenProviderForTests(null) })

function eventStream(blocks) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(block))
      controller.close()
    },
  }), { headers: { 'content-type': 'text/event-stream' } })
}

test('a manual retry sends the same message id, intent and account token', async () => {
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
  assert.equal(requests[0].options.headers.Authorization, 'Bearer account-token')
  assert.match(requests[0].options.headers.Accept, /text\/event-stream/)
})

test('streamed events arrive in order, including split chunks', async () => {
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
})

test('an error event rejects with the saved failed turn attached', async () => {
  globalThis.fetch = async () => eventStream([
    'event: start\ndata: {"status":"processing"}\n\n',
    'event: error\ndata: {"status":"failed","error_message":"The tutor took too long to respond.","can_retry":true}\n\n',
  ])
  await assert.rejects(sendTutorChatMessage('part', 'Help', clientId), (error) => {
    assert.equal(error.turn.can_retry, true)
    return /took too long/.test(error.message)
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

test('marking requests and results use the account token', async () => {
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify(options.method === 'POST' ? { id: 'a1', status: 'completed' } : { assessments: [] }))
  }
  assert.deepEqual(await getTutorReviews('2'), [])
  assert.equal((await requestTutorReview('part-1', 3)).status, 'completed')
  assert.deepEqual(JSON.parse(requests[1].options.body), { expected_revision: 3 })
  assert.ok(requests.every((request) => request.options.headers.Authorization === 'Bearer account-token'))
})

test('an API 401 is returned without silently creating another user', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return Response.json({ detail: 'Sign in again.' }, { status: 401 }) }
  await assert.rejects(getTutorReviews('2'), /Sign in again/)
  assert.equal(calls, 1)
})
