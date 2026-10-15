const STORAGE_KEY = 'math-mate-drafts-v1'
const LEGACY_TOPIC_2_KEY = 'math-mate-topic-2-drafts-v1'

function readAllDrafts() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  } catch {
    return {}
  }
}

export function readDrafts(topicNumber) {
  const drafts = readAllDrafts()[String(topicNumber)] || {}
  if (String(topicNumber) !== '2') return drafts
  try {
    return { ...JSON.parse(localStorage.getItem(LEGACY_TOPIC_2_KEY) || '{}'), ...drafts }
  } catch {
    return drafts
  }
}

export function saveDraft(topicNumber, partId, typedWork) {
  const all = readAllDrafts()
  const key = String(topicNumber)
  all[key] = { ...(all[key] || {}), [partId]: typedWork }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  return { question_part_id: partId, typed_work: typedWork, attachments: [], revision: 1 }
}
