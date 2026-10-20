// Pure helpers for the practice workspace: part grouping, part status and tutor help.

// Assistance level of each teaching move, mirroring ASSISTANCE in backend/app/tutoring/policy.py.
export const MOVE_ASSISTANCE = {
  check_understanding: 0, encourage: 0, redirect: 0, invite_resubmit: 0,
  ask_question: 1, small_hint: 2, formula_reminder: 2,
  explain_concept: 3, similar_example: 3, worked_step: 4, full_solution: 5,
}
export const MAX_ASSISTANCE = 5

export const TEACHING_MOVE_LABELS = {
  ask_question: 'Think it through',
  small_hint: 'Small hint',
  formula_reminder: 'Formula reminder',
  worked_step: 'One worked step',
  similar_example: 'Similar example',
  explain_concept: 'Concept explanation',
  check_understanding: 'Check your thinking',
  encourage: 'Tutor',
  redirect: 'Back to the question',
  invite_resubmit: 'Ready to check again',
  full_solution: 'Full solution',
}

const isPending = (status) => status === 'pending' || status === 'processing'

function labelTokens(label) {
  const tokens = String(label || '').match(/\([^)]*\)/g)
  return tokens?.length ? tokens : [String(label || '')]
}

function sameBlock(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Leaf parts arrive flattened, with nested labels joined ("(a)(i)") and the parent's
 * prompt repeated in every child. Group consecutive siblings so the shared text is
 * shown once: each group has `sharedPrompt` and items with only their own `prompt`.
 */
export function groupParts(parts = []) {
  const groups = []
  for (const part of parts) {
    const tokens = labelTokens(part.label)
    const parentLabel = tokens.length > 1 ? tokens.slice(0, -1).join('') : null
    const previous = groups[groups.length - 1]
    if (parentLabel && previous?.parentLabel === parentLabel) previous.parts.push(part)
    else groups.push({ parentLabel, parts: [part] })
  }
  return groups.map((group) => {
    if (group.parts.length < 2) {
      return { key: group.parts[0].id, parentLabel: null, sharedPrompt: [], items: group.parts.map((part) => ({ part, prompt: part.prompt || [] })) }
    }
    const prompts = group.parts.map((part) => part.prompt || [])
    let shared = 0
    while (prompts.every((prompt) => prompt.length > shared && sameBlock(prompt[shared], prompts[0][shared]))) shared += 1
    // Keep at least one block for each part so no part is left without its question.
    while (shared > 0 && prompts.some((prompt) => prompt.length <= shared)) shared -= 1
    return {
      key: `${group.parentLabel}-${group.parts[0].id}`,
      parentLabel: group.parentLabel,
      sharedPrompt: prompts[0].slice(0, shared),
      items: group.parts.map((part, index) => ({ part, prompt: prompts[index].slice(shared) })),
    }
  })
}

/** The text of the first readable block, for a one-line preview of a collapsed part. */
export function previewText(blocks = []) {
  const block = blocks.find((item) => typeof item?.content === 'string' && item.content.trim())
  return block ? block.content : ''
}

const byAttempt = (left, right) => (left.attempt_number - right.attempt_number)
  || (new Date(left.created_at) - new Date(right.created_at))

/** The latest AI marking result for a part, or null. */
export function latestReview(reviews = [], partId) {
  const items = reviews.filter((review) => review.question_part_id === partId).sort(byAttempt)
  return items[items.length - 1] || null
}

export function isFullMarks(review) {
  return Boolean(review && review.status === 'completed' && review.outcome === 'marked'
    && review.marks_maximum > 0 && review.marks_awarded === review.marks_maximum)
}

/**
 * One status per part for its chip: marks when checked, otherwise saved or submitted work.
 * `tone` is one of good, part, bad, neutral, brand.
 */
export function partStatus({ review, submitted = false, hasWork = false, checking = false }) {
  if (checking || (review && isPending(review.status))) return { kind: 'checking', tone: 'brand', label: 'Checking…' }
  if (review?.status === 'failed') return { kind: 'failed', tone: 'bad', label: 'Not checked' }
  if (review?.status === 'completed') {
    if (review.outcome !== 'marked') return { kind: 'unmarked', tone: 'part', label: 'Not marked' }
    const { marks_awarded: awarded, marks_maximum: maximum } = review
    const tone = awarded === maximum ? 'good' : awarded > 0 ? 'part' : 'bad'
    return { kind: tone === 'good' ? 'full' : tone === 'part' ? 'partial' : 'zero', tone, label: `${awarded} of ${maximum}` }
  }
  if (submitted) return { kind: 'submitted', tone: 'neutral', label: 'Submitted' }
  if (hasWork) return { kind: 'draft', tone: 'neutral', label: 'In progress' }
  return { kind: 'new', tone: 'neutral', label: 'Not started' }
}

/**
 * Whether tutor help existed before this attempt was checked. The backend stores the same
 * rule as `independent`: any completed turn on the part with assistance above zero.
 */
export function wasAssisted(turns = [], partId, review) {
  if (!review) return false
  const checkedAt = new Date(review.created_at)
  return turns.some((turn) => turn.question_part_id === partId && turn.status === 'completed'
    && (MOVE_ASSISTANCE[turn.teaching_move] || 0) > 0 && new Date(turn.created_at) < checkedAt)
}

/**
 * Highest help reached on a part since it was last answered with full marks.
 * Returns { level, move } where level is 0 to MAX_ASSISTANCE.
 */
export function helpLevel(turns = [], reviews = [], partId) {
  const lastSolved = reviews.filter((review) => review.question_part_id === partId && isFullMarks(review))
    .map((review) => new Date(review.created_at)).sort((a, b) => a - b).pop()
  let best = { level: 0, move: null }
  for (const turn of turns) {
    if (turn.question_part_id !== partId || turn.status !== 'completed') continue
    if (lastSolved && new Date(turn.created_at) <= lastSolved) continue
    const level = MOVE_ASSISTANCE[turn.teaching_move] || 0
    if (level > best.level) best = { level, move: turn.teaching_move }
  }
  return best
}

/** The part to open first: the first one not yet answered with full marks. */
export function firstOpenPart(parts = [], reviews = []) {
  return parts.find((part) => !isFullMarks(latestReview(reviews, part.id))) || parts[0]
}
