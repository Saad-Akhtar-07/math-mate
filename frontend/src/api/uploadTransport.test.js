import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { uploadMultipart, fileFingerprint } from './uploadTransport.js'
import FakeXMLHttpRequest from './testing/FakeXMLHttpRequest.js'

const original = globalThis.XMLHttpRequest
beforeEach(() => { FakeXMLHttpRequest.reset(); globalThis.XMLHttpRequest = FakeXMLHttpRequest })
afterEach(() => {
  if (original) globalThis.XMLHttpRequest = original
  else delete globalThis.XMLHttpRequest
})
const options = (extra = {}) => ({ body: new FormData(), headers: { Accept: 'application/json', Authorization: 'Bearer test' }, ...extra })

test('reports actual transfer progress and waits for server confirmation after 100%', async () => {
  const progress = []
  let finished = false
  const promise = uploadMultipart('/upload', options({ onProgress: (value) => progress.push(value) })).then((value) => { finished = true; return value })
  const xhr = FakeXMLHttpRequest.instances[0]
  assert.equal(xhr.method, 'POST')
  assert.equal(xhr.headers.Authorization, 'Bearer test')
  assert.equal(xhr.headers['Content-Type'], undefined)
  assert.equal(xhr.timeout, 120000)
  xhr.progress(25, 100)
  xhr.progress(200, 100)
  xhr.progress(5, 0, false)
  xhr.transferred()
  await Promise.resolve()
  assert.equal(finished, false)
  assert.deepEqual(progress, [
    { phase: 'uploading', percent: 0 }, { phase: 'uploading', percent: 25 },
    { phase: 'uploading', percent: 100 }, { phase: 'uploading', percent: null },
    { phase: 'saving', percent: null },
  ])
  xhr.respond(200, { revision: 2, attachments: [] })
  assert.equal((await promise).revision, 2)
  assert.equal(xhr.upload.onprogress, null)
  assert.equal(xhr.onload, null)
})

test('network interruptions and timeouts leave the outcome uncertain without automatic retransmission', async () => {
  for (const action of ['fail', 'expire']) {
    const promise = uploadMultipart('/upload', options())
    FakeXMLHttpRequest.instances.at(-1)[action]()
    await assert.rejects(promise, (error) => error.uncertain === true)
  }
  assert.equal(FakeXMLHttpRequest.instances.length, 2)
})

test('HTTP failures preserve safe detail, status and whether a save needs checking', async () => {
  for (const [status, uncertain] of [[0, true], [409, false], [422, false], [503, true], [408, true]]) {
    const promise = uploadMultipart('/upload', options())
    FakeXMLHttpRequest.instances.at(-1).respond(status, { detail: 'Please retry later' })
    await assert.rejects(promise, (error) => error.status === status && error.uncertain === uncertain && error.message === 'Please retry later')
  }
})

test('malformed success cannot mark a photo saved', async () => {
  const promise = uploadMultipart('/upload', options())
  FakeXMLHttpRequest.instances[0].respond(200, { message: 'OK' })
  await assert.rejects(promise, (error) => error.uncertain === true)
})

test('pre-aborted requests never send; in-flight aborts release their handlers', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(uploadMultipart('/upload', options({ signal: controller.signal })), { name: 'AbortError' })
  assert.equal(FakeXMLHttpRequest.instances.length, 0)
  const next = new AbortController()
  const promise = uploadMultipart('/upload', options({ signal: next.signal }))
  next.abort()
  await assert.rejects(promise, { name: 'AbortError' })
  const xhr = FakeXMLHttpRequest.instances[0]
  assert.equal(xhr.aborted, true)
  assert.equal(xhr.upload.onprogress, null)
})

test('file fingerprints use the same raw bytes as server deduplication', async () => {
  const file = new File(['solution page'], 'page.jpg')
  assert.equal(await fileFingerprint(file), createHash('sha256').update('solution page').digest('hex'))
  assert.equal(await fileFingerprint({}), null)
})
