import { useEffect, useState } from 'react'
import { getQuestionBank, getQuestionSummary } from '../api/content.js'
import { syllabus } from '../data/syllabus.js'

/** Syllabus topics with their question counts, and the first topic that has questions. */
export function useAvailableTopics() {
  const { summary, loading, error } = useQuestionSummary()
  const counts = summary?.topic_counts || {}
  const topics = syllabus.map((topic) => ({ topic, count: counts[topic.number] || 0 }))
  return { topics, firstTopic: topics.find((item) => item.count > 0)?.topic || null, subtopicCounts: summary?.subtopic_counts || {}, loading, error }
}

export function useQuestionSummary() {
  const [state, setState] = useState({ summary: null, loading: true, error: '' })
  useEffect(() => {
    let active = true
    getQuestionSummary()
      .then((summary) => { if (active) setState({ summary, loading: false, error: '' }) })
      .catch((error) => { if (active) setState({ summary: null, loading: false, error: error.message }) })
    return () => { active = false }
  }, [])
  return state
}

export function useTopicQuestions(topicNumber) {
  const [state, setState] = useState({ topicNumber, questions: [], loading: Boolean(topicNumber), error: '' })
  useEffect(() => {
    if (!topicNumber) return undefined
    let active = true
    setState({ topicNumber, questions: [], loading: true, error: '' })
    getQuestionBank(topicNumber)
      .then((bank) => { if (active) setState({ topicNumber, questions: bank?.questions || [], loading: false, error: '' }) })
      .catch((error) => { if (active) setState({ topicNumber, questions: [], loading: false, error: error.message }) })
    return () => { active = false }
  }, [topicNumber])
  return state.topicNumber === topicNumber ? state : { questions: [], loading: Boolean(topicNumber), error: '' }
}
