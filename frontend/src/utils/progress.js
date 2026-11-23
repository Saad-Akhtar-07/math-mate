// Learner progress worked out in the browser from saved answers and marking results.
import { isFullMarks } from './workspace.js'

/** Latest marking result for each part, keyed by part id. */
export function latestReviewsByPart(reviews = []) {
  const latest = new Map()
  for (const review of reviews) {
    const current = latest.get(review.question_part_id)
    if (!current || review.attempt_number > current.attempt_number
      || (review.attempt_number === current.attempt_number && new Date(review.created_at) > new Date(current.created_at))) {
      latest.set(review.question_part_id, review)
    }
  }
  return latest
}

/** Saved work for each part, keyed by part id. */
export function responsesByPart(responses = []) {
  return new Map(responses.map((response) => [response.question_part_id, response]))
}

const isMarked = (review) => review?.status === 'completed' && review.outcome === 'marked'

function hasWork(response, review) {
  return Boolean(review || response?.submitted || response?.has_work || response?.typed_work?.trim() || response?.attachments?.length)
}

export function questionMarks(question) {
  return question.total_marks ?? question.parts.reduce((sum, part) => sum + (Number(part.marks) || 0), 0)
}

/**
 * One status per question for lists:
 *  - done: every part has full marks
 *  - retry: a checked part is below full marks
 *  - progress: some work is saved, submitted or checked
 *  - new: nothing yet
 */
export function questionProgress(question, responses, reviews) {
  const total = questionMarks(question)
  let earned = 0
  let checked = 0
  let full = 0
  let below = 0
  let worked = 0
  for (const part of question.parts) {
    const review = reviews.get(part.id)
    if (isMarked(review)) {
      checked += 1
      earned += review.marks_awarded
      if (isFullMarks(review)) full += 1
      else below += 1
    }
    if (hasWork(responses.get(part.id), review)) worked += 1
  }
  if (full === question.parts.length) return { status: 'done', tone: 'good', label: `${earned} of ${total} marks`, earned, total }
  if (below > 0) return { status: 'retry', tone: 'bad', label: `Try again · ${earned} of ${total}`, earned, total }
  if (worked > 0) return { status: 'progress', tone: 'part', label: checked ? `In progress · ${earned} of ${total}` : 'In progress', earned, total }
  return { status: 'new', tone: 'neutral', label: `${total} ${total === 1 ? 'mark' : 'marks'}`, earned, total }
}

/**
 * Totals for a set of questions: how many were tried, and the average score across
 * checked parts (null until something has been checked).
 */
export function summariseProgress(questions, responses, reviews) {
  const counts = { new: 0, progress: 0, retry: 0, done: 0 }
  let awarded = 0
  let maximum = 0
  let checked = 0
  for (const question of questions) {
    counts[questionProgress(question, responses, reviews).status] += 1
    for (const part of question.parts) {
      const review = reviews.get(part.id)
      if (isMarked(review)) {
        checked += 1
        awarded += review.marks_awarded
        maximum += review.marks_maximum
      }
    }
  }
  return {
    counts,
    tried: questions.length - counts.new,
    checked,
    average: maximum > 0 ? Math.round((100 * awarded) / maximum) : null,
  }
}

// ---- Dates ----

const dayKey = (value) => {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** The last `days` calendar days, oldest first, marking days with any saved work or checks. */
export function practiceDays(responses = [], reviews = [], now = new Date(), days = 7) {
  const active = new Set([...responses.map((item) => item.updated_at), ...reviews.map((item) => item.created_at)].filter(Boolean).map(dayKey))
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - index))
    return { date, practised: active.has(dayKey(date)), today: index === days - 1 }
  })
}

/** "Today", "Yesterday", "3 days ago", "Last week", or a short date. */
export function relativeDay(value, now = new Date()) {
  if (!value) return ''
  const date = new Date(value)
  const startOf = (item) => new Date(item.getFullYear(), item.getMonth(), item.getDate())
  const days = Math.round((startOf(now) - startOf(date)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'Last week'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// ---- Subtopics ----

function lastActivity(questions, responses, reviews) {
  let latest = null
  for (const question of questions) {
    for (const part of question.parts) {
      for (const value of [responses.get(part.id)?.updated_at, reviews.get(part.id)?.created_at]) {
        if (value && (!latest || new Date(value) > new Date(latest))) latest = value
      }
    }
  }
  return latest
}

/** Progress for each subtopic of a syllabus topic, in syllabus order. */
export function subtopicStats(topic, questions, responses, reviews) {
  return topic.subtopics.map((subtopic) => {
    const own = questions.filter((question) => question.subtopicCodes?.includes(subtopic.code))
    return { subtopic, questions: own, ...summariseProgress(own, responses, reviews), lastActivity: lastActivity(own, responses, reviews) }
  })
}

/** The subtopic most in need of practice: the lowest average below 70% with at least two checked parts. */
export function focusSubtopic(stats) {
  return stats.filter((item) => item.checked >= 2 && item.average !== null && item.average < 70)
    .sort((left, right) => left.average - right.average || right.checked - left.checked)[0] || null
}

// ---- What to do next ----

const DIFFICULTY_RANK = { easy: 1, medium: 2, hard: 3 }
const isMarkable = (question) => question.parts.some((part) => part.aiMarkable !== false)
const easiestFirst = (questions) => questions.map((question, index) => ({ question, index }))
  .sort((left, right) => (DIFFICULTY_RANK[left.question.difficulty?.label] || 2) - (DIFFICULTY_RANK[right.question.difficulty?.label] || 2) || left.index - right.index)
  .map((item) => item.question)

/** The unfinished question worked on most recently, or null. */
export function continueQuestion(questions, responses, reviews) {
  let best = null
  for (const question of questions) {
    const progress = questionProgress(question, responses, reviews)
    if (progress.status === 'new' || progress.status === 'done') continue
    const at = lastActivity([question], responses, reviews)
    if (at && (!best || new Date(at) > new Date(best.at))) best = { question, progress, at }
  }
  return best
}

/**
 * Up to `limit` questions to try next, each with the reason it was chosen:
 * a question to try again, then the weakest subtopic, then a subtopic not yet tried,
 * then the next new question in subtopics already started.
 */
export function suggestQuestions(topic, questions, responses, reviews, { exclude = [], limit = 3 } = {}) {
  const chosen = []
  const used = new Set(exclude)
  const add = (question, subtopic, kind, label, reason) => {
    if (!question || used.has(question.id) || chosen.length >= limit) return
    used.add(question.id)
    chosen.push({ question, subtopic, kind, label, reason })
  }
  const statusOf = (question) => questionProgress(question, responses, reviews)
  const subtopicOf = (question) => topic.subtopics.find((item) => question.subtopicCodes?.includes(item.code))
  const firstNew = (list) => easiestFirst(list.filter((question) => isMarkable(question) && statusOf(question).status === 'new'))
    .find((question) => !used.has(question.id))

  const retry = questions.filter((question) => statusOf(question).status === 'retry')
    .map((question) => ({ question, at: lastActivity([question], responses, reviews) }))
    .sort((left, right) => new Date(right.at) - new Date(left.at))[0]
  if (retry) {
    const { earned, total } = statusOf(retry.question)
    add(retry.question, subtopicOf(retry.question), 'retry', 'Try again', `You scored ${earned} of ${total} last time. A fresh attempt usually goes better.`)
  }

  const stats = subtopicStats(topic, questions, responses, reviews)
  const focus = focusSubtopic(stats)
  if (focus) add(firstNew(focus.questions), focus.subtopic, 'focus', 'Focus area', `${focus.subtopic.title} is your lowest-scoring subtopic so far, at ${focus.average}%.`)

  for (const item of stats.filter((entry) => entry.tried === 0 && entry.questions.length)) {
    add(firstNew(item.questions), item.subtopic, 'new', 'Something new', `You haven't tried ${item.subtopic.title} yet. This is a good first question.`)
  }
  for (const item of stats.filter((entry) => entry.tried > 0)) {
    add(firstNew(item.questions), item.subtopic, 'next', 'Keep going', `The next new question in ${item.subtopic.title}.`)
  }
  return chosen
}
