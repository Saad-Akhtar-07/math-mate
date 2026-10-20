import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import {
  firstOpenPart, groupParts, helpLevel, latestReview, partStatus, previewText, wasAssisted,
} from './workspace.js'

const block = (content) => ({ type: 'paragraph', content })
const review = (fields) => ({ question_part_id: 'p', status: 'completed', outcome: 'marked', attempt_number: 1,
  created_at: '2026-10-19T10:00:00Z', marks_awarded: 0, marks_maximum: 2, ...fields })
const turn = (fields) => ({ question_part_id: 'p', status: 'completed', created_at: '2026-10-19T09:00:00Z', ...fields })

test('nested siblings share their parent text once', () => {
  const stem = block('A bag contains red and blue counters.')
  const groups = groupParts([
    { id: 'q-a-i', label: '(a)(i)', prompt: [stem, block('Find the probability of red.')] },
    { id: 'q-a-ii', label: '(a)(ii)', prompt: [stem, block('Find the probability of blue.')] },
    { id: 'q-b', label: '(b)', prompt: [block('Explain your answer.')] },
  ])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].parentLabel, '(a)')
  assert.deepEqual(groups[0].sharedPrompt, [stem])
  assert.deepEqual(groups[0].items.map((item) => item.prompt), [[block('Find the probability of red.')], [block('Find the probability of blue.')]])
  assert.equal(groups[1].parentLabel, null)
  assert.deepEqual(groups[1].items[0].prompt, [block('Explain your answer.')])
})

test('a child whose prompt is only the parent text keeps it', () => {
  const stem = block('Solve the equation.')
  const groups = groupParts([
    { id: 'a-i', label: '(a)(i)', prompt: [stem] },
    { id: 'a-ii', label: '(a)(ii)', prompt: [stem, block('Check your answer.')] },
  ])
  assert.deepEqual(groups[0].sharedPrompt, [])
  assert.deepEqual(groups[0].items[0].prompt, [stem])
})

test('single and unlabelled parts are left as they are', () => {
  const groups = groupParts([{ id: 'q-main', label: 'Answer', prompt: [] }, { id: 'q-b-i', label: '(b)(i)', prompt: [block('x')] }])
  assert.equal(groups.length, 2)
  assert.ok(groups.every((group) => group.parentLabel === null && group.sharedPrompt.length === 0))
})

test('every leaf part in the question bank keeps its own prompt after grouping', () => {
  const dataDir = new URL('../../../data/', import.meta.url)
  const leaves = (part, prompts = [], labels = []) => {
    const nextPrompts = [...prompts, ...(part.prompt || [])]
    const nextLabels = [...labels, part.label].filter(Boolean)
    return part.parts?.length ? part.parts.flatMap((child) => leaves(child, nextPrompts, nextLabels))
      : [{ ...part, label: nextLabels.join('') || 'Answer', prompt: nextPrompts }]
  }
  let checked = 0
  for (const file of readdirSync(dataDir).filter((name) => name.endsWith('.json'))) {
    for (const question of JSON.parse(readFileSync(new URL(file, dataDir), 'utf8')).questions) {
      const parts = (question.parts || []).flatMap((part) => leaves(part))
      const groups = groupParts(parts)
      assert.equal(groups.flatMap((group) => group.items).length, parts.length, question.id)
      for (const group of groups) {
        for (const item of group.items) {
          // Shared text plus the part's own text must rebuild the original prompt exactly.
          assert.deepEqual([...group.sharedPrompt, ...item.prompt], item.part.prompt || [], item.part.id)
          if ((item.part.prompt || []).length) assert.ok(item.prompt.length > 0, item.part.id)
          checked += 1
        }
      }
    }
  }
  assert.ok(checked > 300)
})

test('preview uses the first readable block', () => {
  assert.equal(previewText([{ type: 'graph' }, block('Find $x$.')]), 'Find $x$.')
  assert.equal(previewText([]), '')
})

test('latest review follows attempt order', () => {
  const reviews = [review({ id: 2, attempt_number: 2 }), review({ id: 1 }), review({ id: 3, question_part_id: 'other', attempt_number: 9 })]
  assert.equal(latestReview(reviews, 'p').id, 2)
  assert.equal(latestReview(reviews, 'missing'), null)
})

test('part status reflects marks, checking and saved work', () => {
  assert.deepEqual(partStatus({ review: review({ marks_awarded: 2 }) }), { kind: 'full', tone: 'good', label: '2 of 2' })
  assert.equal(partStatus({ review: review({ marks_awarded: 1 }) }).kind, 'partial')
  assert.equal(partStatus({ review: review({}) }).kind, 'zero')
  assert.equal(partStatus({ review: review({ outcome: 'unreadable' }) }).kind, 'unmarked')
  assert.equal(partStatus({ review: review({ status: 'processing' }) }).kind, 'checking')
  assert.equal(partStatus({ review: review({ status: 'failed' }) }).kind, 'failed')
  assert.equal(partStatus({ checking: true }).kind, 'checking')
  assert.equal(partStatus({ submitted: true }).kind, 'submitted')
  assert.equal(partStatus({ hasWork: true }).kind, 'draft')
  assert.equal(partStatus({}).kind, 'new')
})

test('an attempt counts as helped only after a turn that gave assistance', () => {
  const checked = review({ created_at: '2026-10-19T10:00:00Z' })
  assert.equal(wasAssisted([turn({ teaching_move: 'encourage' })], 'p', checked), false)
  assert.equal(wasAssisted([turn({ teaching_move: 'small_hint' })], 'p', checked), true)
  assert.equal(wasAssisted([turn({ teaching_move: 'small_hint', created_at: '2026-10-19T11:00:00Z' })], 'p', checked), false)
  assert.equal(wasAssisted([turn({ teaching_move: 'small_hint', status: 'failed' })], 'p', checked), false)
})

test('help level resets after full marks', () => {
  const turns = [turn({ teaching_move: 'worked_step' }), turn({ teaching_move: 'small_hint', created_at: '2026-10-19T12:00:00Z' })]
  assert.deepEqual(helpLevel(turns, [], 'p'), { level: 4, move: 'worked_step' })
  assert.deepEqual(helpLevel(turns, [review({ marks_awarded: 2 })], 'p'), { level: 2, move: 'small_hint' })
  assert.deepEqual(helpLevel([], [], 'p'), { level: 0, move: null })
})

test('the first part without full marks opens first', () => {
  const parts = [{ id: 'a' }, { id: 'b' }]
  assert.equal(firstOpenPart(parts, [review({ question_part_id: 'a', marks_awarded: 2 })]).id, 'b')
  assert.equal(firstOpenPart(parts, []).id, 'a')
  assert.equal(firstOpenPart(parts, parts.map((part) => review({ question_part_id: part.id, marks_awarded: 2 }))).id, 'a')
})
