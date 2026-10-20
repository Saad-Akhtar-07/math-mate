import { useEffect, useState } from 'react'
import { getStudentResponses, getTutorReviews, hasGuestSession } from '../api/submissions.js'
import { readDrafts } from '../data/localDrafts.js'
import { latestReviewsByPart, responsesByPart } from '../utils/progress.js'

// Maps hold the latest per part; the lists keep every saved answer and attempt (for dates and history).
const EMPTY = { responses: new Map(), reviews: new Map(), responseList: [], reviewList: [] }

/**
 * Saved work and latest marks for a topic, for showing progress in lists.
 * Reads only: without an existing guest workspace it reports no progress rather than creating one.
 * Questions served from bundled data (local-only mode) use the drafts saved on this device.
 */
export default function useLearnerProgress(topicNumber, questions, questionsLoading) {
  const [state, setState] = useState({ key: '', ...EMPTY, loading: true, error: '' })
  const localOnly = questions.some((question) => question.localDraftOnly)
  const aiEnabled = questions.some((question) => !question.localDraftOnly && question.capabilities?.aiTutor !== false)
  const key = `${topicNumber}:${questions.length}:${localOnly}:${aiEnabled}`

  useEffect(() => {
    if (!topicNumber || questionsLoading) return undefined
    if (!questions.length) {
      setState({ key, ...EMPTY, loading: false, error: '' })
      return undefined
    }
    if (localOnly) {
      const drafts = Object.entries(readDrafts(topicNumber)).map(([id, typedWork]) => ({ question_part_id: id, typed_work: typedWork }))
      setState({ key, ...EMPTY, responses: responsesByPart(drafts), responseList: drafts, loading: false, error: '' })
      return undefined
    }
    if (!hasGuestSession()) {
      setState({ key, ...EMPTY, loading: false, error: '' })
      return undefined
    }
    let active = true
    setState((current) => ({ ...current, key, loading: true, error: '' }))
    Promise.all([getStudentResponses(topicNumber), aiEnabled ? getTutorReviews(topicNumber) : []])
      .then(([responses, reviews]) => {
        if (active) setState({ key, responses: responsesByPart(responses), reviews: latestReviewsByPart(reviews), responseList: responses, reviewList: reviews, loading: false, error: '' })
      })
      .catch((error) => { if (active) setState({ key, ...EMPTY, loading: false, error: error.message }) })
    return () => { active = false }
  }, [key, questionsLoading])

  return state.key === key ? state : { ...EMPTY, loading: true, error: '' }
}
