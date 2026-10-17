import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readDrafts, saveDraft, removeDraft } from '../data/localDrafts.js'

afterEach(() => { delete globalThis.localStorage })

test('a server save cannot erase another tab’s newer local recovery copy', () => {
  const values = new Map()
  globalThis.localStorage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
  saveDraft('2', 'part-a', 'Older tab')
  saveDraft('2', 'part-a', 'Newer tab')
  removeDraft('2', 'part-a', 'Older tab')
  assert.equal(readDrafts('2')['part-a'], 'Newer tab')
  removeDraft('2', 'part-a', 'Newer tab')
  assert.equal(readDrafts('2')['part-a'], undefined)
})
