// URLs shared by several screens.

/** The workspace for one question, stepping through its subtopic's questions. */
export function workspacePath(topicNumber, question, subtopicCode = question.subtopicCodes?.[0]) {
  const params = new URLSearchParams()
  if (subtopicCode) params.set('subtopic', subtopicCode)
  params.set('question', question.id)
  return `/topic/${topicNumber}/practice?${params}`
}
