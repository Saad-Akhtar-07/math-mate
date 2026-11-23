import { BookOpenCheck, CircleDashed } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import * as contentApi from '../api/content.js'
import {
  getStudentResponses,
  getStudentResponse,
  getTutorChatTurns,
  getTutorReviews,
  removeSolutionImage,
  requestTutorReview,
  saveStudentResponse,
  submitStudentResponse,
  sendTutorChatMessage,
  uploadSolutionImage,
} from '../api/submissions.js'
import PartCard from '../components/workspace/PartCard.jsx'
import QuestionBlock from '../components/workspace/QuestionBlock.jsx'
import TutorPanel from '../components/workspace/TutorPanel.jsx'
import TutorResizer from '../components/workspace/TutorResizer.jsx'
import WorkspaceHeader from '../components/workspace/WorkspaceHeader.jsx'
import { syllabus } from '../data/syllabus.js'
import { readDrafts, saveDraft, removeDraft } from '../data/localDrafts.js'
import useSolutionUploads from '../hooks/useSolutionUploads.js'
import { firstOpenPart, groupParts, helpLevel, isFullMarks, latestReview, partStatus, wasAssisted } from '../utils/workspace.js'
import NotFound from './NotFound.jsx'
import './PracticeWorkspace.css'
import './Workspace.css'

const TUTOR_OPEN_STORAGE_KEY = 'practice-tutor-open-v1'
const SERVER_SAVE_DELAY_MS = 1500

function storedTutorOpen() {
  try { return localStorage.getItem(TUTOR_OPEN_STORAGE_KEY) !== 'false' }
  catch { return true }
}

const isPending = (status) => status === 'pending' || status === 'processing'

function sentenceCase(text) {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : ''
}

function createEmptyQuestion(topic) {
  return {
    id: `topic-${topic.number || 'unknown'}-empty`,
    isPlaceholder: true,
    number: '—',
    title: `${topic.title || 'Topic'} practice`,
    syllabus_codes: [],
    total_marks: 0,
    prompt: [],
    parts: [{
      id: `topic-${topic.number || 'unknown'}-empty-part`,
      label: '',
      marks: 0,
      prompt: [],
    }],
  }
}

function QuestionPlaceholder({ topic, loading, error, filtered, backTo }) {
  if (loading) {
    return <div className="ws-placeholder" role="status" aria-label="Loading questions">
      <span className="ws-skeleton is-short" /><span className="ws-skeleton is-title" /><span className="ws-skeleton" /><span className="ws-skeleton" /><span className="ws-skeleton is-box" />
    </div>
  }
  return <div className="ws-empty-card">
    <span className="ws-empty-icon" aria-hidden="true">{error ? <CircleDashed size={24} /> : <BookOpenCheck size={24} />}</span>
    <h1>{error ? 'Questions could not be loaded' : filtered ? 'No questions match' : `Questions for ${topic.title} are coming soon`}</h1>
    <p>{error ? 'Check your connection and try again.' : filtered ? 'Go back and choose another set of questions.' : 'They will appear here when they are added.'}</p>
    {error ? <button type="button" className="ws-small-button is-primary" onClick={() => window.location.reload()}>Try again</button>
      : <Link className="ws-small-button" to={backTo}>Go back</Link>}
  </div>
}

export default function QuestionPracticePage() {
  const { topicNumber } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const topic = syllabus.find((item) => item.number === topicNumber)
  const [questionBank, setQuestionBank] = useState(null)
  const [questionDetail, setQuestionDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [isLoading, setIsLoading] = useState(Boolean(topic))
  const [loadError, setLoadError] = useState('')
  const questions = questionBank?.questions || []
  const hasQuestions = questions.length > 0
  const usesLocalDrafts = questions.some((item) => item.localDraftOnly)
  const aiEnabled = questions.some((item) => !item.localDraftOnly && item.capabilities?.aiTutor !== false)
  const subtopicFilter = searchParams.get('subtopic') || 'all'
  const paperFilter = searchParams.get('paper') || 'all'
  const difficultyFilter = searchParams.get('difficulty') || 'all'
  const searchQuery = searchParams.get('q') || ''
  const visibleQuestions = questions.filter((item) => {
    if (subtopicFilter !== 'all' && !item.subtopicCodes?.includes(subtopicFilter)) return false
    if (paperFilter === 'calculator' && !item.paper?.calculatorAllowed) return false
    if (paperFilter === 'non-calculator' && item.paper?.calculatorAllowed) return false
    if (difficultyFilter !== 'all' && item.difficulty?.label !== difficultyFilter) return false
    if (searchQuery && !`${item.title} ${item.paper?.year || ''} ${item.paper?.component || ''} ${item.number}`.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })
  const requestedQuestionId = searchParams.get('question')
  const selectedIndex = Math.max(0, visibleQuestions.findIndex((item) => item.id === requestedQuestionId))
  const selectedQuestion = visibleQuestions[selectedIndex] || visibleQuestions[0] || null
  const emptyQuestion = createEmptyQuestion(topic || {})
  const [answers, setAnswers] = useState({})
  const [visualAnswers, setVisualAnswers] = useState({})
  const [attachments, setAttachments] = useState({})
  const [saveStates, setSaveStates] = useState({})
  const [saveMessages, setSaveMessages] = useState({})
  const [responseLoadError, setResponseLoadError] = useState('')
  const [responsesReady, setResponsesReady] = useState(false)
  const [submittedParts, setSubmittedParts] = useState({})
  const [pageMutations, setPageMutations] = useState({})
  const [conflicts, setConflicts] = useState({})
  const [activePartId, setActivePartId] = useState('')
  const [reviews, setReviews] = useState([])
  const [reviewStates, setReviewStates] = useState({})
  const [reviewErrors, setReviewErrors] = useState({})
  const [chatTurns, setChatTurns] = useState([])
  const [chatStates, setChatStates] = useState({})
  const [tutorOpen, setTutorOpen] = useState(storedTutorOpen)
  // On narrow screens the question and the tutor are two tabs.
  const [mobileView, setMobileView] = useState('question')
  const answersRef = useRef({})
  const visualAnswersRef = useRef({})
  const visualExportersRef = useRef(new Map())
  const revisionsRef = useRef(new Map())
  const conflictsRef = useRef(new Set())
  const restoreFailedRef = useRef(false)
  const saveTimersRef = useRef(new Map())
  const saveVersionsRef = useRef(new Map())
  const saveQueuesRef = useRef(new Map())
  const busyPartsRef = useRef(new Set())
  const questionColumnRef = useRef(null)
  const bundledQuestion = Array.isArray(selectedQuestion?.prompt) ? selectedQuestion : null
  const question = selectedQuestion && questionDetail?.id === selectedQuestion.id
    ? questionDetail : bundledQuestion || emptyQuestion
  // Until the learner picks a part, open the first one not yet answered with full marks.
  const activePart = question.parts.find((part) => part.id === activePartId) || firstOpenPart(question.parts, reviews)

  const photoUploads = useSolutionUploads({
    scope: topicNumber,
    attachments,
    canStart: (partId) => responsesReady && !restoreFailedRef.current && !busyPartsRef.current.has(partId) && !conflictsRef.current.has(partId),
    onBusy: (partId, busy) => {
      if (busy) busyPartsRef.current.add(partId)
      else busyPartsRef.current.delete(partId)
      setPageMutations((current) => ({ ...current, [partId]: busy }))
    },
    prepare: async (partId) => {
      clearTimeout(saveTimersRef.current.get(partId))
      saveTimersRef.current.delete(partId)
      await persistAnswer(partId, answersRef.current[partId] || '')
      setSaveStates((current) => ({ ...current, [partId]: 'uploading' }))
      setSaveMessages((current) => ({ ...current, [partId]: 'Saving photos…' }))
    },
    send: (partId, file, options) => applyPageMutation(partId,
      (revision) => uploadSolutionImage(partId, file, revision, options), options.signal),
    read: (partId, options) => applyPageMutation(partId,
      () => getStudentResponse(partId, options), options.signal),
    onError: (partId, error) => pageMutationError(partId, error),
    onComplete: (partId, response) => {
      setSaveStates((current) => ({ ...current, [partId]: 'saved' }))
      setSaveMessages((current) => ({ ...current, [partId]: `${response.attachments.length} solution page${response.attachments.length === 1 ? '' : 's'} saved` }))
    },
  })

  useEffect(() => {
    let cancelled = false
    if (!topic) return undefined
    setIsLoading(true)
    setLoadError('')
    setQuestionBank(null)
    contentApi.getQuestionBank(topic.number)
      .then((bank) => {
        if (!cancelled) setQuestionBank(bank)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [topic])

  useEffect(() => {
    let cancelled = false
    if (!selectedQuestion?.id) {
      setQuestionDetail(null)
      setDetailLoading(false)
      setDetailError('')
      return undefined
    }
    // Test fixtures and the legacy compatibility endpoint may already contain
    // the full prompt. The production catalogue intentionally does not.
    if (Array.isArray(selectedQuestion.prompt)) {
      setQuestionDetail(selectedQuestion)
      setDetailLoading(false)
      setDetailError('')
      return undefined
    }
    setQuestionDetail((current) => current?.id === selectedQuestion.id ? current : null)
    setDetailLoading(true)
    setDetailError('')
    contentApi.getQuestionDetail(selectedQuestion.id)
      .then((detail) => {
        if (cancelled) return
        setQuestionDetail(detail)
        const next = visibleQuestions[selectedIndex + 1]
        if (next) void contentApi.getQuestionDetail(next.id).catch(() => {})
      })
      .catch((error) => { if (!cancelled) setDetailError(error.message) })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [selectedQuestion?.id])

  useEffect(() => {
    setAnswers({})
    answersRef.current = {}
    setVisualAnswers({})
    visualAnswersRef.current = {}
    visualExportersRef.current.clear()
    setAttachments({})
    setSaveStates({})
    setSaveMessages({})
    setResponseLoadError('')
    setResponsesReady(false)
    setSubmittedParts({})
    setPageMutations({})
    setConflicts({})
    revisionsRef.current.clear()
    conflictsRef.current.clear()
    restoreFailedRef.current = false
    setActivePartId('')
    setReviews([])
    setReviewStates({})
    setReviewErrors({})
    setChatTurns([])
    setChatStates({})
    saveTimersRef.current.forEach((timer) => clearTimeout(timer))
    saveTimersRef.current.clear()
    if (!topic) return undefined
    let cancelled = false
    if (!questionBank?.questions?.length) return undefined
    const storedContent = usesLocalDrafts
      ? Promise.resolve([Object.entries(readDrafts(topic.number)).map(([id, typed_work]) => ({ question_part_id: id, typed_work, attachments: [] })), [], []])
      : Promise.all([getStudentResponses(topic.number), aiEnabled ? getTutorReviews(topic.number) : [], aiEnabled ? getTutorChatTurns(topic.number) : []])
    storedContent
      .then(([responses, restoredReviews, restoredChatTurns]) => {
        if (cancelled) return
        const restoredAnswers = {}
        const restoredVisualAnswers = {}
        const restoredAttachments = {}
        const restoredStates = {}
        const restoredSubmitted = {}
        const restoredConflicts = {}
        const local = readDrafts(topic.number)
        responses.forEach((response) => {
          restoredAnswers[response.question_part_id] = response.typed_work
          if (response.visual_answer) restoredVisualAnswers[response.question_part_id] = response.visual_answer
          restoredAttachments[response.question_part_id] = response.attachments
          restoredStates[response.question_part_id] = 'saved'
          revisionsRef.current.set(response.question_part_id, response.revision)
          restoredSubmitted[response.question_part_id] = Boolean(response.submitted)
          if (!usesLocalDrafts && Object.hasOwn(local, response.question_part_id) && local[response.question_part_id] !== response.typed_work) {
            conflictsRef.current.add(response.question_part_id)
            restoredConflicts[response.question_part_id] = response
            restoredSubmitted[response.question_part_id] = false
          }
        })
        answersRef.current = { ...restoredAnswers, ...local, ...answersRef.current }
        visualAnswersRef.current = { ...restoredVisualAnswers, ...visualAnswersRef.current }
        setAnswers(answersRef.current)
        setVisualAnswers(visualAnswersRef.current)
        setAttachments(restoredAttachments)
        setSaveStates((current) => ({ ...restoredStates, ...current }))
        setSubmittedParts(restoredSubmitted)
        setConflicts(restoredConflicts)
        setResponsesReady(true)
        // Recover older device-only drafts; existing server answers require an
        // explicit choice above when they differ from the local recovery copy.
        if (!usesLocalDrafts) {
          const validParts = new Set(questionBank.questions.flatMap((item) => item.parts.map((part) => part.id)))
          for (const [id, value] of Object.entries(local)) {
            if (validParts.has(id) && !restoredConflicts[id]) {
              persistAnswer(id, value).catch(() => {})
            }
          }
        }
        setReviews(restoredReviews)
        setChatTurns(restoredChatTurns)
      })
      .catch((error) => {
        if (!cancelled) {
          restoreFailedRef.current = true
          setResponseLoadError(error.message)
        }
      })
    return () => {
      cancelled = true
      saveTimersRef.current.forEach((timer) => clearTimeout(timer))
      saveTimersRef.current.clear()
    }
  }, [topicNumber, questionBank, usesLocalDrafts, aiEnabled])

  const hasPendingTutorWork = reviews.some((item) => ['pending', 'processing'].includes(item.status))
    || chatTurns.some((item) => ['pending', 'processing'].includes(item.status))
    || Object.values(reviewStates).includes('reviewing')
  useEffect(() => {
    if (!hasPendingTutorWork || !topic) return undefined
    let cancelled = false
    let timer
    const refresh = async () => {
      const results = await Promise.allSettled([getTutorReviews(topicNumber), getTutorChatTurns(topicNumber)])
      if (cancelled) return
      if (results[0].status === 'fulfilled') setReviews(results[0].value)
      if (results[1].status === 'fulfilled') {
        const saved = results[1].value
        setChatTurns((current) => [...saved, ...current.filter((turn) =>
          !saved.some((item) => item.client_message_id === turn.client_message_id))])
      }
      timer = setTimeout(refresh, 2500)
    }
    timer = setTimeout(refresh, 2500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [hasPendingTutorWork, topicNumber])

  useEffect(() => {
    if (!topic) return
    document.title = hasQuestions && visibleQuestions.length
      ? `${topic.title} practice - Question ${question.number} - Mathematics 4024`
      : `${topic.title} practice - Mathematics 4024`
    window.scrollTo(0, 0)
  }, [hasQuestions, question.number, topic, visibleQuestions.length])

  useEffect(() => {
    questionColumnRef.current?.scrollTo?.({ top: 0 })
  }, [question.id])

  if (!topic) return <NotFound />

  const moveTo = (index) => {
    if (!visibleQuestions.length) return
    const nextIndex = Math.max(0, Math.min(visibleQuestions.length - 1, index))
    const nextQuestion = visibleQuestions[nextIndex]
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('question', nextQuestion.id)
    setSearchParams(nextParams)
    setActivePartId('')
    setMobileView('question')
  }

  const persistAnswer = async (partId, value, status = 'draft', visualAnswer = visualAnswersRef.current[partId] || null) => {
    if (!usesLocalDrafts && (restoreFailedRef.current || conflictsRef.current.has(partId))) {
      throw new Error('Choose which saved answer to keep before saving this draft.')
    }
    const version = (saveVersionsRef.current.get(partId) || 0) + 1
    saveVersionsRef.current.set(partId, version)
    setSaveStates((current) => ({ ...current, [partId]: 'saving' }))
    setSaveMessages((current) => ({ ...current, [partId]: '' }))
    try {
      // Serialize saves so a slow older draft cannot overwrite newer work.
      const previous = saveQueuesRef.current.get(partId) || Promise.resolve()
      const operation = previous.catch(() => {}).then(() => {
        if (usesLocalDrafts) return saveDraft(topic.number, partId, value)
        const revision = revisionsRef.current.get(partId) || 0
        return visualAnswer === null
          ? saveStudentResponse(partId, value, revision)
          : saveStudentResponse(partId, value, revision, visualAnswer)
      })
      saveQueuesRef.current.set(partId, operation)
      const response = await operation
      revisionsRef.current.set(partId, response.revision)
      if (!usesLocalDrafts && (answersRef.current[partId] || '') === value) {
        try { removeDraft(topic.number, partId, value) } catch { /* Keep the recovery copy if browser storage is unavailable. */ }
        setSubmittedParts((current) => ({ ...current, [partId]: Boolean(response.submitted) }))
      }
      setAttachments((current) => ({ ...current, [partId]: response.attachments }))
      if (saveVersionsRef.current.get(partId) === version) {
        setSaveStates((current) => ({ ...current, [partId]: 'saved' }))
        setSaveMessages((current) => ({
          ...current,
          [partId]: usesLocalDrafts ? 'Saved on this device' : response.submitted ? 'Answer submitted' : 'Saved',
        }))
      }
      return response
    } catch (error) {
      if (error.status === 409) {
        conflictsRef.current.add(partId)
        getStudentResponses(topic.number).then((responses) => {
          const remote = responses.find((response) => response.question_part_id === partId)
          if (remote) setConflicts((current) => ({ ...current, [partId]: remote }))
        }).catch(() => {})
      }
      if (saveVersionsRef.current.get(partId) === version) {
        setSaveStates((current) => ({ ...current, [partId]: 'error' }))
        setSaveMessages((current) => ({ ...current, [partId]: error.message }))
      }
      throw error
    }
  }

  const changeAnswer = (partId, value) => {
    answersRef.current = { ...answersRef.current, [partId]: value }
    setAnswers(answersRef.current)
    setSubmittedParts((current) => ({ ...current, [partId]: false }))
    saveVersionsRef.current.set(partId, (saveVersionsRef.current.get(partId) || 0) + 1)
    try {
      saveDraft(topic.number, partId, value)
      if (usesLocalDrafts) {
        setSaveStates((current) => ({ ...current, [partId]: 'saved' }))
        setSaveMessages((current) => ({ ...current, [partId]: 'Saved on this device' }))
        return
      }
    } catch {
      setResponseLoadError('Browser recovery storage is unavailable. Keep this page open until your work is saved to the server.')
    }
    // Recovery is already on this device. Show network activity only when the
    // debounced server request actually begins, rather than on every keystroke.
    setSaveStates((current) => ({ ...current, [partId]: 'idle' }))
    setSaveMessages((current) => ({ ...current, [partId]: 'Saved on this device' }))
    clearTimeout(saveTimersRef.current.get(partId))
    const timer = setTimeout(() => {
      saveTimersRef.current.delete(partId)
      persistAnswer(partId, value).catch(() => {})
    }, SERVER_SAVE_DELAY_MS)
    saveTimersRef.current.set(partId, timer)
  }

  const changeVisualAnswer = (partId, value) => {
    visualAnswersRef.current = { ...visualAnswersRef.current, [partId]: value }
    setVisualAnswers(visualAnswersRef.current)
    setSubmittedParts((current) => ({ ...current, [partId]: false }))
    setSaveStates((current) => ({ ...current, [partId]: 'idle' }))
    setSaveMessages((current) => ({ ...current, [partId]: 'Drawing changes waiting to sync' }))
    clearTimeout(saveTimersRef.current.get(partId))
    const timer = setTimeout(() => {
      saveTimersRef.current.delete(partId)
      persistAnswer(partId, answersRef.current[partId] || '', 'draft', value).catch(() => {})
    }, SERVER_SAVE_DELAY_MS)
    saveTimersRef.current.set(partId, timer)
  }

  const saveNow = (part) => {
    clearTimeout(saveTimersRef.current.get(part.id))
    saveTimersRef.current.delete(part.id)
    persistAnswer(part.id, answersRef.current[part.id] || '').catch(() => {})
  }

  const resolveConflict = (partId, keepLocal) => {
    const remote = conflicts[partId]
    revisionsRef.current.set(partId, remote.revision)
    conflictsRef.current.delete(partId)
    setConflicts((current) => { const next = { ...current }; delete next[partId]; return next })
    if (keepLocal) {
      persistAnswer(partId, answersRef.current[partId] || '').catch(() => {})
    } else {
      clearTimeout(saveTimersRef.current.get(partId))
      saveTimersRef.current.delete(partId)
      answersRef.current = { ...answersRef.current, [partId]: remote.typed_work }
      visualAnswersRef.current = { ...visualAnswersRef.current, [partId]: remote.visual_answer || null }
      setAnswers(answersRef.current)
      setVisualAnswers(visualAnswersRef.current)
      setAttachments((current) => ({ ...current, [partId]: remote.attachments || [] }))
      setSubmittedParts((current) => ({ ...current, [partId]: Boolean(remote.submitted) }))
      setSaveStates((current) => ({ ...current, [partId]: 'saved' }))
      setSaveMessages((current) => ({ ...current, [partId]: 'Restored saved answer' }))
      try { removeDraft(topic.number, partId, answers[partId]) } catch { /* Recovery copy may remain. */ }
    }
  }

  const submitAnswer = async (part) => {
    if (busyPartsRef.current.has(part.id) || conflictsRef.current.has(part.id) || photoUploads.pendingCount(part.id)) return
    busyPartsRef.current.add(part.id)
    clearTimeout(saveTimersRef.current.get(part.id))
    saveTimersRef.current.delete(part.id)
    const value = answersRef.current[part.id] || ''
    try {
      const saved = await persistAnswer(part.id, value)
      setSaveStates((current) => ({ ...current, [part.id]: 'submitting' }))
      await submitStudentResponse(part.id, saved.revision)
      if ((answersRef.current[part.id] || '') === value) {
        setSubmittedParts((current) => ({ ...current, [part.id]: true }))
        setSaveStates((current) => ({ ...current, [part.id]: 'saved' }))
        setSaveMessages((current) => ({ ...current, [part.id]: 'Answer submitted. You can edit it and submit a new attempt.' }))
      }
    } catch (error) {
      setSaveStates((current) => ({ ...current, [part.id]: 'error' }))
      setSaveMessages((current) => ({ ...current, [part.id]: error.message }))
    } finally { busyPartsRef.current.delete(part.id) }
  }

  const applyPageMutation = (partId, operation, signal) => {
    const previous = saveQueuesRef.current.get(partId) || Promise.resolve()
    const pending = previous.catch(() => {}).then(async () => {
      signal?.throwIfAborted()
      const response = await operation(revisionsRef.current.get(partId))
      signal?.throwIfAborted()
      if (typeof response.typed_work === 'string' && response.typed_work !== (answersRef.current[partId] || '')) {
        const error = new Error('This answer changed in another tab. Choose which saved answer to keep before continuing.')
        error.status = 409
        throw error
      }
      revisionsRef.current.set(partId, response.revision)
      setAttachments((current) => ({ ...current, [partId]: response.attachments }))
      setSubmittedParts((current) => ({ ...current, [partId]: Boolean(response.submitted) }))
      return response
    })
    saveQueuesRef.current.set(partId, pending)
    return pending
  }

  const pageMutationError = (partId, error) => {
    setSaveStates((current) => ({ ...current, [partId]: 'error' }))
    setSaveMessages((current) => ({ ...current, [partId]: error.message }))
    if (error.status === 409) {
      conflictsRef.current.add(partId)
      getStudentResponse(partId).then((remote) => {
        setConflicts((current) => ({ ...current, [partId]: remote }))
      }).catch(() => {})
    }
  }

  const discardUpload = (partId, id) => {
    const item = photoUploads.queues[partId]?.find((candidate) => candidate.id === id)
    if (photoUploads.remove(partId, id) && item?.error === saveMessages[partId]) {
      setSaveStates((current) => ({ ...current, [partId]: 'idle' }))
      setSaveMessages((current) => ({ ...current, [partId]: '' }))
    }
  }

  const deleteImage = async (part, attachmentId) => {
    if (busyPartsRef.current.has(part.id) || conflictsRef.current.has(part.id)) return
    busyPartsRef.current.add(part.id)
    setPageMutations((current) => ({ ...current, [part.id]: true }))
    clearTimeout(saveTimersRef.current.get(part.id))
    saveTimersRef.current.delete(part.id)
    try {
      await persistAnswer(part.id, answersRef.current[part.id] || '')
      setSaveStates((current) => ({ ...current, [part.id]: 'saving' }))
      setSaveMessages((current) => ({ ...current, [part.id]: 'Removing page...' }))
      await applyPageMutation(part.id, (revision) => removeSolutionImage(part.id, attachmentId, revision))
      setSaveStates((current) => ({ ...current, [part.id]: 'saved' }))
      setSaveMessages((current) => ({ ...current, [part.id]: 'Page removed from this draft. Submitted answers keep their pages.' }))
    } catch (error) { pageMutationError(part.id, error) }
    finally {
      busyPartsRef.current.delete(part.id)
      setPageMutations((current) => ({ ...current, [part.id]: false }))
    }
  }

  const askTutor = async (type, part) => {
    if (!hasQuestions || busyPartsRef.current.has(part.id)) return
    if (type === 'hint') {
      return sendTutorMessage(part, 'Please give me one small hint for the next step, without revealing the answer.', undefined, 'hint')
    }
    busyPartsRef.current.add(part.id)
    setReviewErrors((current) => ({ ...current, [part.id]: '' }))
    setActivePartId(part.id)
    clearTimeout(saveTimersRef.current.get(part.id))
    saveTimersRef.current.delete(part.id)
    setReviewStates((current) => ({ ...current, [part.id]: 'reviewing' }))
    try {
      let saved = await persistAnswer(
        part.id,
        answersRef.current[part.id] || '',
        'ready_for_review',
      )
      const visual = visualAnswersRef.current[part.id]
      if (part.visualResponse && visual?.primary_source === 'canvas') {
        const exporter = visualExportersRef.current.get(part.id)
        if (!exporter) throw new Error('This visual answer needs a clear photo before it can be checked.')
        const blob = await exporter()
        const file = new File([blob], `${part.id}-visual-answer.jpg`, { type: 'image/jpeg' })
        saved = await applyPageMutation(part.id, (revision) =>
          uploadSolutionImage(part.id, file, revision, { role: 'primary_visual', visualSource: 'canvas' }))
      }
      const review = await requestTutorReview(part.id, saved.revision)
      setReviews((current) => {
        const withoutDuplicate = current.filter((item) => item.id !== review.id)
        return [...withoutDuplicate, review].sort((a, b) => a.attempt_number - b.attempt_number)
      })
      setReviewStates((current) => ({ ...current, [part.id]: 'complete' }))
      // Marking submits this revision; it stays submitted until the work changes.
      if ((answersRef.current[part.id] || '') === saved.typed_work) setSubmittedParts((current) => ({ ...current, [part.id]: true }))
    } catch (error) {
      setReviewStates((current) => ({ ...current, [part.id]: 'error' }))
      setReviewErrors((current) => ({ ...current, [part.id]: error.message }))
      getTutorReviews(topic.number).then(setReviews).catch(() => {})
    } finally {
      busyPartsRef.current.delete(part.id)
    }
  }

  const sendTutorMessage = async (part, message, clientMessageId = crypto.randomUUID(), intent = 'message') => {
    if (!hasQuestions || busyPartsRef.current.has(part.id)) return
    busyPartsRef.current.add(part.id)
    setActivePartId(part.id)
    if (saveTimersRef.current.has(part.id)) {
      clearTimeout(saveTimersRef.current.get(part.id))
      saveTimersRef.current.delete(part.id)
      try {
        await persistAnswer(part.id, answersRef.current[part.id] || '')
      } catch {
        // The learner can still ask for help if saving their separate work area fails.
      }
    }
    setChatStates((current) => ({ ...current, [part.id]: 'sending' }))
    setChatTurns((current) => {
      const existing = current.find((turn) => turn.client_message_id === clientMessageId)
      const optimistic = {
        ...(existing || {}),
        id: existing?.id || clientMessageId,
        client_message_id: clientMessageId,
        question_part_id: part.id,
        intent,
        learner_message: message,
        tutor_message: null,
        status: 'processing',
        error_message: null,
        created_at: existing?.created_at || new Date().toISOString(),
      }
      return [...current.filter((turn) => turn.client_message_id !== clientMessageId), optimistic]
    })
    try {
      // Show the reply as it streams; the saved turn replaces it when the stream finishes.
      const turn = await sendTutorChatMessage(part.id, message, clientMessageId, {
        intent,
        onEvent: ({ type, data }) => setChatTurns((current) => current.map((item) => {
          if (item.client_message_id !== clientMessageId) return item
          if (type === 'start') return { ...item, teaching_move: data.teaching_move, tutor_message: '' }
          if (type === 'delta') return { ...item, tutor_message: `${item.tutor_message || ''}${data.text}` }
          if (type === 'reset') return { ...item, tutor_message: '' }
          return item
        })),
      })
      setChatTurns((current) => [
        ...current.filter((item) => item.client_message_id !== clientMessageId),
        turn,
      ])
      setChatStates((current) => ({ ...current, [part.id]: 'complete' }))
    } catch (error) {
      setChatStates((current) => ({ ...current, [part.id]: 'error' }))
      setChatTurns((current) => current.map((turn) => (
        turn.client_message_id === clientMessageId
          ? { ...turn, status: 'failed', error_message: error.message }
          : turn
      )))
      getTutorChatTurns(topic.number).then((restored) => {
        setChatTurns((current) => {
          const transient = current.filter((turn) => (
            !restored.some((item) => item.client_message_id === turn.client_message_id)
            && ['processing', 'failed'].includes(turn.status)
          ))
          return [...restored, ...transient]
        })
      }).catch(() => {})
    } finally {
      busyPartsRef.current.delete(part.id)
    }
  }

  const subtopic = subtopicFilter !== 'all' ? topic.subtopics.find((item) => item.code === subtopicFilter) : null
  // Back to the list the learner came from, with the same paper and difficulty filters.
  const listFilters = new URLSearchParams([...searchParams].filter(([key, value]) => ['paper', 'difficulty'].includes(key) && value !== 'all')).toString()
  const backTo = subtopic ? `/topic/${topic.number}/${subtopic.code}${listFilters ? `?${listFilters}` : ''}` : `/topic/${topic.number}`
  const backLabel = subtopic ? `${subtopic.code} ${subtopic.title}` : topic.title
  const availability = question.isPlaceholder ? 'empty' : usesLocalDrafts ? 'local' : aiEnabled ? 'ready' : 'off'
  const filtered = hasQuestions && !visibleQuestions.length

  const toggleTutor = () => {
    const next = !tutorOpen
    setTutorOpen(next)
    try { localStorage.setItem(TUTOR_OPEN_STORAGE_KEY, String(next)) } catch { /* The choice still applies on this page. */ }
  }

  // check: Check my work submits and AI-marks; submit: save an attempt without AI; local: no server action.
  const partMode = (part) => {
    if (question.localDraftOnly) return 'local'
    if (aiEnabled && part.aiMarkable !== false) return 'check'
    return question.capabilities?.submitResponses ? 'submit' : 'local'
  }
  const isPartBusy = (partId) => reviewStates[partId] === 'reviewing' || chatStates[partId] === 'sending'
    || reviews.some((item) => item.question_part_id === partId && isPending(item.status))
    || chatTurns.some((item) => item.question_part_id === partId && isPending(item.status))
  // After full marks: the next part that still needs work, otherwise the next question.
  const nextStep = (part) => {
    const index = question.parts.findIndex((item) => item.id === part.id)
    const nextPart = question.parts.slice(index + 1).find((item) => !isFullMarks(latestReview(reviews, item.id)))
    if (nextPart) return { label: 'Next part', go: () => setActivePartId(nextPart.id) }
    if (selectedIndex < visibleQuestions.length - 1) return { label: 'Next question', go: () => moveTo(selectedIndex + 1) }
    return null
  }
  const partLabel = (partId) => question.parts.find((part) => part.id === partId)?.label || 'this part'

  const renderPart = ({ part, prompt }) => {
    const review = latestReview(reviews, part.id)
    const checking = reviewStates[part.id] === 'reviewing' || isPending(review?.status)
    const submitted = Boolean(submittedParts[part.id])
    const next = nextStep(part)
    const visualBlock = part.visualResponse
      ? [...(part.prompt || []), ...(question.prompt || [])].find((block) => block?.type === 'graph' || block?.type === 'diagram')
      : null
    const visiblePrompt = visualBlock ? prompt.filter((block) => block !== visualBlock) : prompt
    const visual = visualAnswers[part.id]
    return <PartCard
      key={part.id}
      part={part}
      prompt={visiblePrompt}
      expanded={part.id === activePart.id}
      status={partStatus({ review, submitted, checking, hasWork: Boolean((answers[part.id] || '').trim()
        || attachments[part.id]?.length || visual?.objects?.length) })}
      onExpand={() => setActivePartId(part.id)}
      onActivate={() => setActivePartId(part.id)}
      mode={partMode(part)}
      aiMarkable={part.aiMarkable}
      answer={answers[part.id] || ''}
      attachments={attachments[part.id] || []}
      saveState={saveStates[part.id] || 'idle'}
      saveMessage={saveMessages[part.id] || ''}
      ready={responsesReady && !pageMutations[part.id] && saveStates[part.id] !== 'submitting'}
      submitted={submitted}
      uploadsEnabled={!question.localDraftOnly && question.capabilities?.uploads === true}
      showHistory={!question.localDraftOnly && Boolean(question.capabilities?.submitResponses)}
      review={review}
      checking={checking}
      checkError={reviewErrors[part.id]}
      assisted={wasAssisted(chatTurns, part.id, review)}
      tutorBusy={isPartBusy(part.id)}
      onNext={next?.go}
      nextLabel={next?.label}
      onAnswerChange={(value) => changeAnswer(part.id, value)}
      onCheck={() => askTutor('check', part)}
      onSubmit={() => submitAnswer(part)}
      onUpload={(files) => photoUploads.enqueue(part.id, files)}
      visualAnswer={visual}
      visualBlock={visualBlock}
      onVisualAnswerChange={(value) => changeVisualAnswer(part.id, value)}
      onPrimaryUpload={(files) => {
        if (visualAnswersRef.current[part.id]?.primary_source !== 'photo') {
          changeVisualAnswer(part.id, { version: 'visual-answer-v1', primary_source: 'photo', objects: [] })
        }
        photoUploads.enqueue(part.id, files, 'primary_visual', 'photo')
      }}
      registerVisualExporter={(exporter) => {
        if (exporter) visualExportersRef.current.set(part.id, exporter)
        else visualExportersRef.current.delete(part.id)
      }}
      onRemoveAttachment={(attachmentId) => deleteImage(part, attachmentId)}
      uploadQueue={photoUploads.queues[part.id] || []}
      uploadBusy={Boolean(pageMutations[part.id])}
      uploadBlocked={conflictsRef.current.has(part.id)}
      onRetryUpload={(id) => photoUploads.retry(part.id, id)}
      onDiscardUpload={(id) => discardUpload(part.id, id)}
    />
  }

  return <div className={`practice-shell ws${tutorOpen ? '' : ' is-tutor-closed'}`}>
    <WorkspaceHeader backTo={backTo} backLabel={backLabel} position={selectedIndex + 1} total={visibleQuestions.length}
      onPrevious={() => moveTo(selectedIndex - 1)} onNext={() => moveTo(selectedIndex + 1)} tutorOpen={tutorOpen} onToggleTutor={toggleTutor} />
    <div className="ws-view-tabs" role="group" aria-label="Workspace view">
      <button type="button" aria-pressed={mobileView === 'question'} onClick={() => setMobileView('question')}>Question</button>
      <button type="button" aria-pressed={mobileView === 'tutor'} onClick={() => setMobileView('tutor')}>Tutor</button>
    </div>
    <div className="ws-body" data-view={mobileView}>
      <main className="ws-question" id="main-content" tabIndex="-1" ref={questionColumnRef}>
        <div className="ws-question-inner">
          {responseLoadError && <div className="ws-alert" role="alert">{responseLoadError} <button type="button" className="ws-small-button" onClick={() => window.location.reload()}>Reload saved work</button></div>}
          {!responsesReady && hasQuestions && !responseLoadError && <p className="ws-quiet-status" role="status">Restoring your saved work…</p>}
          {Object.entries(conflicts).map(([partId, remote]) => <section className="ws-alert ws-conflict" key={partId} aria-label="Choose saved answer">
            <p><strong>Part {partLabel(partId)} has different work on this device and on the server.</strong> Choose which answer to keep.</p>
            <details><summary>Compare answers</summary><strong>On this device</strong><pre>{answers[partId]}</pre><strong>Saved answer</strong><pre>{remote.typed_work}</pre></details>
            <div className="ws-conflict-actions">
              <button type="button" className="ws-small-button" onClick={() => resolveConflict(partId, true)}>Save my local draft instead</button>
              <button type="button" className="ws-small-button" onClick={() => resolveConflict(partId, false)}>Use saved answer</button>
            </div>
          </section>)}

          {visibleQuestions.length && (questionDetail?.id === selectedQuestion?.id || bundledQuestion) ? <article className="ws-paper" key={question.id}>
            <div className="ws-meta">
              {question.paper && <span className="ws-meta-chip">{question.paper.session} {question.paper.year} · Paper {question.paper.component} · Q{question.number}</span>}
              {question.paper && <span className="ws-meta-chip">{question.paper.calculatorAllowed ? 'Calculator' : 'Non-calculator'}</span>}
              {question.difficulty?.label && <span className="ws-meta-chip">{sentenceCase(question.difficulty.label)}</span>}
              <span className="ws-meta-marks">{question.total_marks} {question.total_marks === 1 ? 'mark' : 'marks'}</span>
            </div>
            <h1 className="ws-title">{question.title}</h1>
            {question.prompt.length > 0 && <div className="question-stimulus">{question.prompt.map((block, index) => <QuestionBlock block={block} key={index} />)}</div>}
            <div className="ws-parts">
              {groupParts(question.parts).map((group) => group.parentLabel ? <div className="ws-part-group" key={group.key}>
                {group.sharedPrompt.length > 0 && <div className="ws-part-group-intro">
                  <span className="ws-part-label">{group.parentLabel}</span>
                  <div className="question-part-prompt">{group.sharedPrompt.map((block, index) => <QuestionBlock block={block} key={index} />)}</div>
                </div>}
                {group.items.map(renderPart)}
              </div> : <Fragment key={group.key}>{group.items.map(renderPart)}</Fragment>)}
            </div>
          </article> : <QuestionPlaceholder topic={topic} loading={isLoading || detailLoading} error={loadError || detailError} filtered={filtered} backTo={backTo} />}
        </div>
      </main>
      {tutorOpen && <TutorResizer />}
      <TutorPanel
        className={tutorOpen ? '' : 'is-closed'}
        availability={availability}
        topicTitle={topic.title}
        activePart={activePart}
        reviews={reviews}
        reviewState={reviewStates[activePart.id] || 'idle'}
        chatTurns={chatTurns}
        chatState={chatStates[activePart.id] || 'idle'}
        help={helpLevel(chatTurns, reviews, activePart.id)}
        onRequest={askTutor}
        onSendMessage={sendTutorMessage}
        onRetryMessage={(part, turn) => sendTutorMessage(part, turn.learner_message, turn.client_message_id, turn.intent || 'message')}
        onClose={toggleTutor}
      />
    </div>
  </div>
}
