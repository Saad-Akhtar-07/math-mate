import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { getStudentResponse, getStudentResponses, saveStudentResponse, submitStudentResponse, uploadSolutionImage, removeSolutionImage, getSolutionImageUrl } from './submissions.js'
import FakeXMLHttpRequest from './testing/FakeXMLHttpRequest.js'

const originalFetch = globalThis.fetch
const guestKey = 'math-mate-guest-session-v1'
let values
beforeEach(() => {
  values = new Map([[guestKey, JSON.stringify({ access_token: 'private-test-token', expires_at: '2099-01-01T00:00:00Z' })]])
  globalThis.localStorage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
})
afterEach(() => { globalThis.fetch = originalFetch; delete globalThis.localStorage; delete globalThis.XMLHttpRequest; FakeXMLHttpRequest.reset() })

test('guest credentials use Authorization and saves carry the expected revision', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/me/responses/part-a')
    assert.equal(options.headers.Authorization, 'Bearer private-test-token')
    assert.deepEqual(JSON.parse(options.body), { typed_work: 'x = 5', expected_revision: 7 })
    return Response.json({ revision: 8 })
  }
  assert.equal((await saveStudentResponse('part-a', 'x = 5', 7)).revision, 8)
})

test('all response pages are restored', async () => {
  let calls = 0
  globalThis.fetch = async (url) => {
    calls++
    if (calls === 1) return Response.json({ responses: [{ question_part_id: 'a' }], next_cursor: 'a' })
    assert.match(url, /after=a$/)
    return Response.json({ responses: [{ question_part_id: 'b' }], next_cursor: null })
  }
  assert.equal((await getStudentResponses('2')).length, 2)
})

test('invalid guest credentials fail without creating or replacing a learner', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return Response.json({ detail: 'Guest session expired or invalid' }, { status: 401 }) }
  await assert.rejects(submitStudentResponse('part-a', 3), /expired or invalid/)
  assert.equal(calls, 1)
  assert.match(values.get(guestKey), /private-test-token/)
})

test('concurrent first requests create one guest and persist its credential', async () => {
  values.clear()
  let creations = 0
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/learner-sessions')) {
      creations++
      return Response.json({ access_token: 'new-private-token', expires_at: '2099-01-01T00:00:00Z' })
    }
    assert.equal(options.headers.Authorization, 'Bearer new-private-token')
    return Response.json({ revision: 1 })
  }
  await Promise.all([saveStudentResponse('a', 'first'), saveStudentResponse('b', 'second')])
  assert.equal(creations, 1)
  assert.match(values.get(guestKey), /new-private-token/)
})

test('guest creation rechecks a session established by another tab under the browser lock', async () => {
  values.clear()
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: async (_, operation) => {
      values.set(guestKey, JSON.stringify({ access_token: 'other-tab-token', expires_at: '2099-01-01T00:00:00Z' }))
      return operation()
    },
  } } })
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/v1/me/responses/a')
      assert.equal(options.headers.Authorization, 'Bearer other-tab-token')
      return Response.json({ revision: 1 })
    }
    await saveStudentResponse('a', 'Work')
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor)
    else delete globalThis.navigator
  }
})

test('page upload sends a guest-authenticated form with the expected revision', async () => {
  globalThis.XMLHttpRequest = FakeXMLHttpRequest
  FakeXMLHttpRequest.onSend = (xhr) => {
    assert.equal(xhr.url, '/api/v1/me/responses/part-a/attachments')
    assert.equal(xhr.headers.Authorization, 'Bearer private-test-token')
    assert.equal(xhr.headers['Content-Type'], undefined)
    assert.equal(xhr.body.get('expected_revision'), '4')
    assert.equal(xhr.body.get('image').name, 'page.jpg')
    xhr.respond(200, { revision: 5, attachments: [] })
  }
  await uploadSolutionImage('part-a', new File(['page'], 'page.jpg', { type: 'image/jpeg' }), 4)
})

test('checking one saved answer uses authenticated GET and supports cancellation', async () => {
  const controller = new AbortController()
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/me/responses/part%20a')
    assert.equal(options.headers.Authorization, 'Bearer private-test-token')
    controller.abort()
    assert.equal(options.signal.aborted, true)
    throw new DOMException('Stopped', 'AbortError')
  }
  await assert.rejects(getStudentResponse('part a', { signal: controller.signal }), { name: 'AbortError' })
})

test('page removal carries the expected revision and returns updated work', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/me/responses/part-a/attachments/image-a?expected_revision=7')
    assert.equal(options.method, 'DELETE')
    return Response.json({ revision: 8, attachments: [] })
  }
  assert.equal((await removeSolutionImage('part-a', 'image-a', 7)).revision, 8)
})

test('temporary image links are requested through the authenticated API', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/me/solution-files/file-a/url')
    assert.equal(options.headers.Authorization, 'Bearer private-test-token')
    return Response.json({ url: 'https://storage.example.test/temporary-image' })
  }
  assert.match((await getSolutionImageUrl('file-a')).url, /^https:/)
})
