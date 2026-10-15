import { useEffect, useState } from 'react'
import { getQuestionBank, getQuestionSummary } from '../api/content.js'

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
