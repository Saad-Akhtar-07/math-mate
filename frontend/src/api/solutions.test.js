import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { getStudentResponse, getStudentResponses, saveStudentResponse, uploadSolutionImage, removeSolutionImage, getSolutionImageUrl } from './submissions.js'
import { setAccessTokenProviderForTests } from '../auth/supabase.js'
import FakeXMLHttpRequest from './testing/FakeXMLHttpRequest.js'

const originalFetch = globalThis.fetch
beforeEach(() => setAccessTokenProviderForTests(async () => 'private-test-token'))
afterEach(() => { globalThis.fetch = originalFetch; delete globalThis.XMLHttpRequest; FakeXMLHttpRequest.reset(); setAccessTokenProviderForTests(null) })

test('account credentials use Authorization and saves carry the expected revision', async () => {
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

test('page upload sends an authenticated form with the expected revision', async () => {
  globalThis.XMLHttpRequest = FakeXMLHttpRequest
  FakeXMLHttpRequest.onSend = (xhr) => {
    assert.equal(xhr.url, '/api/v1/me/responses/part-a/attachments')
    assert.equal(xhr.headers.Authorization, 'Bearer private-test-token')
    assert.equal(xhr.headers['Content-Type'], undefined)
    assert.equal(xhr.body.get('expected_revision'), '4')
    assert.deepEqual(xhr.body.getAll('role'), ['supporting_work'])
    assert.equal(xhr.body.get('visual_source'), null)
    xhr.respond(200, { revision: 5, attachments: [] })
  }
  await uploadSolutionImage('part-a', new File(['page'], 'page.jpg', { type: 'image/jpeg' }), 4)
})

test('a primary photo declares one authoritative visual source', async () => {
  globalThis.XMLHttpRequest = FakeXMLHttpRequest
  FakeXMLHttpRequest.onSend = (xhr) => {
    assert.deepEqual(xhr.body.getAll('role'), ['primary_visual'])
    assert.deepEqual(xhr.body.getAll('visual_source'), ['photo'])
    xhr.respond(200, { revision: 5, attachments: [] })
  }
  await uploadSolutionImage('part-a', new File(['graph'], 'graph.jpg', { type: 'image/jpeg' }), 4,
    { role: 'primary_visual', visualSource: 'photo' })
})

test('checking one saved answer uses authenticated GET and supports cancellation', async () => {
  const controller = new AbortController()
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/me/responses/part%20a')
    assert.equal(options.headers.Authorization, 'Bearer private-test-token')
    controller.abort()
    throw new DOMException('Stopped', 'AbortError')
  }
  await assert.rejects(getStudentResponse('part a', { signal: controller.signal }), { name: 'AbortError' })
})

test('page removal carries the expected revision and returns updated work', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/me/responses/part-a/attachments/image-a?expected_revision=7')
    assert.equal(options.method, 'DELETE')
    return Response.json({ revision: 8 })
  }
  assert.equal((await removeSolutionImage('part-a', 'image-a', 7)).revision, 8)
})

test('temporary image links are requested through the authenticated API', async () => {
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer private-test-token')
    return Response.json({ url: 'https://storage.example.test/temporary-image' })
  }
  assert.match((await getSolutionImageUrl('file-a')).url, /^https:/)
})
