import assert from 'node:assert/strict'
import test from 'node:test'
import {
  continueQuestion, focusSubtopic, latestReviewsByPart, practiceDays, questionProgress, relativeDay, responsesByPart,
  subtopicStats, suggestQuestions, summariseProgress,
} from './progress.js'

const question = { id: 'q', total_marks: 4, parts: [{ id: 'a', marks: 2 }, { id: 'b', marks: 2 }] }
const review = (part, awarded, fields = {}) => ({ question_part_id: part, status: 'completed', outcome: 'marked',
  marks_awarded: awarded, marks_maximum: 2, attempt_number: 1, created_at: '2026-10-19T10:00:00Z', ...fields })
const progress = (responses, reviews) => questionProgress(question, responsesByPart(responses), latestReviewsByPart(reviews))

test('the latest attempt wins for each part', () => {
  const latest = latestReviewsByPart([review('a', 2, { attempt_number: 2 }), review('a', 0), review('b', 1)])
  assert.equal(latest.get('a').marks_awarded, 2)
  assert.equal(latest.get('b').marks_awarded, 1)
})

test('a question is new until any work exists', () => {
  assert.deepEqual(progress([], []), { status: 'new', tone: 'neutral', label: '4 marks', earned: 0, total: 4 })
  assert.equal(progress([{ question_part_id: 'a', typed_work: '  ' }], []).status, 'new')
})

test('saved or submitted work is in progress', () => {
  assert.equal(progress([{ question_part_id: 'a', typed_work: 'x = 2' }], []).label, 'In progress')
  assert.equal(progress([{ question_part_id: 'b', typed_work: '', attachments: [{ id: 1 }] }], []).status, 'progress')
  assert.equal(progress([{ question_part_id: 'a', typed_work: '', submitted: true }], []).status, 'progress')
})

test('full marks on some parts stays in progress, with the marks so far', () => {
  assert.equal(progress([], [review('a', 2)]).label, 'In progress · 2 of 4')
})

test('a checked part below full marks asks for another try', () => {
  const result = progress([], [review('a', 2), review('b', 1)])
  assert.equal(result.status, 'retry')
  assert.equal(result.label, 'Try again · 3 of 4')
})

test('full marks on every part is done', () => {
  assert.deepEqual(progress([], [review('a', 2), review('b', 2)]), { status: 'done', tone: 'good', label: '4 of 4 marks', earned: 4, total: 4 })
})

test('unmarked or failed checks count as work but not as marks', () => {
  const result = progress([], [review('a', null, { outcome: 'unreadable' }), review('b', null, { status: 'failed' })])
  assert.equal(result.status, 'progress')
  assert.equal(result.label, 'In progress')
})

test('summary counts statuses and averages checked parts only', () => {
  const other = { id: 'r', total_marks: 2, parts: [{ id: 'c', marks: 2 }] }
  const fresh = { id: 's', total_marks: 3, parts: [{ id: 'd', marks: 3 }] }
  const summary = summariseProgress([question, other, fresh], responsesByPart([]), latestReviewsByPart([review('a', 2), review('b', 1), review('c', 0)]))
  assert.deepEqual(summary.counts, { new: 1, progress: 0, retry: 2, done: 0 })
  assert.equal(summary.checked, 3)
  assert.equal(summary.tried, 2)
  assert.equal(summary.average, 50)
  assert.equal(summariseProgress([fresh], responsesByPart([]), latestReviewsByPart([])).average, null)
})

const now = new Date(2026, 9, 19, 15, 0)
const at = (daysAgo, hour = 10) => new Date(2026, 9, 19 - daysAgo, hour).toISOString()

test('practice days mark activity in the last week, oldest first', () => {
  const days = practiceDays([{ updated_at: at(0) }, { updated_at: at(9) }], [{ created_at: at(2) }], now)
  assert.equal(days.length, 7)
  assert.deepEqual(days.map((day) => day.practised), [false, false, false, false, true, false, true])
  assert.equal(days[6].today, true)
  assert.equal(days[0].date.getDate(), 13)
})

test('relative days read naturally', () => {
  assert.equal(relativeDay(at(0, 1), now), 'Today')
  assert.equal(relativeDay(at(1, 23), now), 'Yesterday')
  assert.equal(relativeDay(at(4), now), '4 days ago')
  assert.equal(relativeDay(at(9), now), 'Last week')
  assert.equal(relativeDay(null, now), '')
})

// A small topic: three subtopics, two questions each, one part per question.
const topic = { number: '2', subtopics: [{ code: '2.1', title: 'Algebra' }, { code: '2.2', title: 'Manipulation' }, { code: '2.3', title: 'Fractions' }] }
const q = (id, code, difficulty = 'medium', fields = {}) => ({ id, subtopicCodes: [code], difficulty: { label: difficulty }, total_marks: 2,
  parts: [{ id: `${id}-a`, marks: 2 }], ...fields })
const bank = [q('a1', '2.1', 'hard'), q('a2', '2.1', 'easy'), q('b1', '2.2'), q('b2', '2.2'), q('c1', '2.3', 'medium', { parts: [{ id: 'c1-a', marks: 2, aiMarkable: false }] }), q('c2', '2.3')]

test('subtopic stats and the focus subtopic', () => {
  const reviews = latestReviewsByPart([review('b1-a', 0), review('b2-a', 1), review('a1-a', 2)])
  const stats = subtopicStats(topic, bank, responsesByPart([]), reviews)
  assert.deepEqual(stats.map((item) => [item.subtopic.code, item.tried, item.average]), [['2.1', 1, 100], ['2.2', 2, 25], ['2.3', 0, null]])
  assert.equal(focusSubtopic(stats).subtopic.code, '2.2')
  // One checked part is not enough evidence for a focus area.
  assert.equal(focusSubtopic(subtopicStats(topic, bank, responsesByPart([]), latestReviewsByPart([review('b1-a', 0)]))), null)
})

test('continue picks the unfinished question worked on most recently', () => {
  const responses = responsesByPart([{ question_part_id: 'a1-a', typed_work: 'x', updated_at: at(3) }, { question_part_id: 'b1-a', typed_work: 'y', updated_at: at(1) }])
  const result = continueQuestion(bank, responses, latestReviewsByPart([review('a2-a', 2, { created_at: at(0) })]))
  assert.equal(result.question.id, 'b1')
  assert.equal(result.progress.status, 'progress')
  assert.equal(continueQuestion(bank, responsesByPart([]), latestReviewsByPart([])), null)
})

test('a new student is offered an easy first question from each subtopic, skipping graph-only ones', () => {
  const picks = suggestQuestions(topic, bank, responsesByPart([]), latestReviewsByPart([]))
  assert.deepEqual(picks.map((item) => [item.question.id, item.kind]), [['a2', 'new'], ['b1', 'new'], ['c2', 'new']])
  assert.match(picks[0].reason, /You haven't tried Algebra yet/)
})

test('suggestions put a retry first, then the weakest subtopic, then something new', () => {
  const reviews = latestReviewsByPart([review('b1-a', 0, { created_at: at(1) }), review('b2-a', 1, { created_at: at(0) })])
  const picks = suggestQuestions({ ...topic, subtopics: [...topic.subtopics, { code: '2.4', title: 'Indices' }] },
    [...bank, q('b3', '2.2', 'easy'), q('d1', '2.4')], responsesByPart([]), reviews, { exclude: ['a2'] })
  assert.deepEqual(picks.map((item) => [item.question.id, item.kind]), [['b2', 'retry'], ['b3', 'focus'], ['a1', 'new']])
  assert.equal(picks[0].reason, 'You scored 1 of 2 last time. A fresh attempt usually goes better.')
  assert.equal(picks[1].reason, 'Manipulation is your lowest-scoring subtopic so far, at 25%.')
})
