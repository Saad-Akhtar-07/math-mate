import assert from 'node:assert/strict'
import test from 'node:test'
import { tutorStreamChunks } from './tutorStreaming.js'

test('stream chunks preserve the response exactly', () => {
  const response = 'First  check this line.\nThen use $x = 4$ carefully.'
  assert.equal(tutorStreamChunks(response).join(''), response)
})

test('stream chunks reveal small groups instead of individual characters', () => {
  assert.deepEqual(tutorStreamChunks('one two three four five six', 4), [
    'one two three four ',
    'five six',
  ])
})

test('stream chunks handle whitespace-only and empty updates safely', () => {
  assert.deepEqual(tutorStreamChunks('   ', 4), ['   '])
  assert.deepEqual(tutorStreamChunks(''), [])
})

test('stream chunks never split a complete maths expression', () => {
  assert.deepEqual(tutorStreamChunks('Now use $x = 4$ before checking the sign.', 3), [
    'Now use $x = 4$ ',
    'before checking the ',
    'sign.',
  ])
})
