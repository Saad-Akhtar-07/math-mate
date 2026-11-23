import { ArrowRight } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import useLearnerProgress from '../hooks/useLearnerProgress.js'
import { useAvailableTopics, useTopicQuestions } from '../hooks/useQuestionContent.js'
import { workspacePath } from '../utils/paths.js'
import { focusSubtopic, relativeDay, subtopicStats, summariseProgress } from '../utils/progress.js'
import { isFullMarks } from '../utils/workspace.js'
import './Dashboard.css'
import './Progress.css'

const RECENT_LIMIT = 8

function resultChip(review) {
  if (review.status === 'pending' || review.status === 'processing') return { tone: 'brand', label: 'Checking…' }
  if (review.status === 'failed') return { tone: 'bad', label: 'Not checked' }
  if (review.outcome !== 'marked') return { tone: 'part', label: 'Not marked' }
  const tone = review.marks_awarded === review.marks_maximum ? 'good' : review.marks_awarded > 0 ? 'part' : 'bad'
  return { tone, label: `${review.marks_awarded} of ${review.marks_maximum}` }
}

export default function ProgressPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const available = useAvailableTopics()
  const choices = available.topics.filter((item) => item.count > 0).map((item) => item.topic)
  const topic = choices.find((item) => item.number === searchParams.get('topic')) || available.firstTopic
  const { questions, loading, error } = useTopicQuestions(topic?.number)
  const progress = useLearnerProgress(topic?.number, questions, loading || available.loading)
  const ready = Boolean(topic) && !loading && !progress.loading

  useEffect(() => {
    document.title = 'Your progress | Math Mate'
    window.scrollTo(0, 0)
  }, [])

  const summary = summariseProgress(questions, progress.responses, progress.reviews)
  const stats = topic ? subtopicStats(topic, questions, progress.responses, progress.reviews) : []
  const focus = focusSubtopic(stats)
  const partInfo = new Map(questions.flatMap((question) => question.parts.map((part) => [part.id, { question, part }])))
  const independentFull = (partIds) => partIds.filter((id) => {
    const review = progress.reviews.get(id)
    return isFullMarks(review) && review.independent !== false
  }).length
  const allParts = questions.flatMap((question) => question.parts.map((part) => part.id))
  const tried = stats.filter((item) => item.tried > 0)
    .sort((left, right) => (left.average ?? 101) - (right.average ?? 101) || right.checked - left.checked)
  const untried = stats.length - tried.length
  const recent = [...progress.reviewList].filter((review) => partInfo.has(review.question_part_id))
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at)).slice(0, RECENT_LIMIT)
  const triedShare = questions.length ? Math.round((100 * summary.tried) / questions.length) : 0
  const helpKnown = true

  return <main className="db-page" id="main-content" tabIndex="-1">
    <div className="db-inner">
      <div className="db-head">
        <div className="db-head-text">
          <h1>Progress</h1>
          <p>Based on the answers you have checked. Marks come from the mark scheme; chatting with the tutor never changes them.</p>
        </div>
        {choices.length > 0 && <label className="pg-topic-select">Topic
          <select value={topic?.number || ''} onChange={(event) => setSearchParams({ topic: event.target.value }, { replace: true })}>
            {choices.map((item) => <option key={item.number} value={item.number}>{item.title}</option>)}
          </select>
        </label>}
      </div>

      {(available.error || error) && <div className="db-empty"><h2>Progress could not be loaded</h2><p>Check your connection and try again.</p><button type="button" className="db-button is-quiet" onClick={() => window.location.reload()}>Try again</button></div>}
      {progress.error && <p className="db-note" role="status">Your progress could not be loaded right now. Please try again later.</p>}
      {!ready && !available.error && !error && <div className="pg-loading" role="status" aria-label="Loading your progress"><div className="db-skeleton" /><div className="db-skeleton" /><div className="db-skeleton" /></div>}

      {ready && !progress.error && summary.tried === 0 && <div className="db-empty">
        <h2>Your progress will appear here</h2>
        <p>Check your first answer and you will see your scores, the subtopics to focus on and your recent attempts.</p>
        <Link className="db-button" to={`/topic/${topic.number}`}>Start practising<ArrowRight size={18} aria-hidden="true" /></Link>
      </div>}

      {ready && summary.tried > 0 && <>
        <div className="pg-tiles">
          <section className="db-card pg-tile" aria-labelledby="tile-tried">
            <h2 id="tile-tried">Questions tried</h2>
            <p className="pg-number">{summary.tried} <span>of {questions.length}</span></p>
            <span className="db-bar" aria-hidden="true"><span style={{ width: `${triedShare}%` }} /></span>
          </section>
          <section className="db-card pg-tile" aria-labelledby="tile-average">
            <h2 id="tile-average">Average score</h2>
            <p className="pg-number">{summary.average === null ? '–' : `${summary.average}%`}</p>
            <p className="db-muted">{summary.checked ? `Across ${summary.checked} checked ${summary.checked === 1 ? 'answer' : 'answers'}` : 'No answers checked yet'}</p>
          </section>
          <section className="db-card pg-tile" aria-labelledby="tile-independent">
            <h2 id="tile-independent">Full marks without help</h2>
            <p className="pg-number">{helpKnown ? independentFull(allParts) : '–'}</p>
            <p className="db-muted">Answers you got fully right on your own</p>
          </section>
        </div>

        <section className="pg-table-card" aria-labelledby="by-subtopic">
          <div className="pg-table-head">
            <h2 id="by-subtopic" className="db-section-title">By subtopic</h2>
            <span className="db-muted">Lowest score first</span>
          </div>
          <div className="pg-table-scroll">
            <table className="pg-table">
              <thead><tr>
                <th scope="col">Subtopic</th><th scope="col">Tried</th><th scope="col">Average score</th>
                <th scope="col">Full marks without help</th><th scope="col">Last practised</th><th scope="col"><span className="sr-only">Action</span></th>
              </tr></thead>
              <tbody>{tried.map((item) => {
                const isFocus = focus?.subtopic.code === item.subtopic.code
                const partIds = item.questions.flatMap((question) => question.parts.map((part) => part.id))
                return <tr key={item.subtopic.code} className={isFocus ? 'is-focus' : undefined}>
                  <td><span className="pg-subtopic"><span className="pg-code">{item.subtopic.code}</span><strong>{item.subtopic.title}</strong>{isFocus && <span className="db-focus">Focus area</span>}</span></td>
                  <td>{item.tried}</td>
                  <td>{item.average === null ? <span className="db-muted">Not checked yet</span>
                    : <span className="pg-score"><span className="db-bar" aria-hidden="true"><span style={{ width: `${item.average}%` }} /></span><strong>{item.average}%</strong></span>}</td>
                  <td>{helpKnown ? `${independentFull(partIds)} of ${item.checked}` : '–'}</td>
                  <td className="pg-when">{relativeDay(item.lastActivity)}</td>
                  <td className="pg-action"><Link className={isFocus ? 'db-button pg-practise' : 'db-button is-quiet pg-practise'} to={`/topic/${topic.number}/${item.subtopic.code}`}>Practise<span className="sr-only"> {item.subtopic.title}</span></Link></td>
                </tr>
              })}</tbody>
            </table>
          </div>
          {untried > 0 && <div className="pg-table-foot"><span>{untried} {untried === 1 ? 'subtopic' : 'subtopics'} not started yet</span><Link className="db-link" to={`/topic/${topic.number}`}>See them in Practice</Link></div>}
        </section>

        {recent.length > 0 && <section className="db-section" aria-labelledby="recent-attempts">
          <h2 id="recent-attempts" className="db-section-title">Recent attempts</h2>
          <ul className="pg-recent">{recent.map((review) => {
            const { question, part } = partInfo.get(review.question_part_id)
            const subtopic = topic.subtopics.find((entry) => question.subtopicCodes?.includes(entry.code))
            const chip = resultChip(review)
            const helped = review.independent === false
            return <li key={review.id}><Link className="pg-attempt" to={workspacePath(topic.number, question, subtopic?.code)}>
              <span className="pg-attempt-when">{relativeDay(review.created_at)}<span>{new Date(review.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></span>
              <span className="pg-attempt-main"><strong>{question.title}{question.parts.length > 1 ? ` · ${part.label}` : ''}</strong>
                <span>{subtopic ? `${subtopic.code} ${subtopic.title} · ` : ''}Attempt {review.attempt_number}</span></span>
              {helpKnown && <span className={`db-chip ${helped ? 'is-brand' : 'is-outline'}`}>{helped ? 'With help' : 'Without help'}</span>}
              <span className={`db-chip is-${chip.tone}`}>{chip.label}</span>
            </Link></li>
          })}</ul>
        </section>}
      </>}
    </div>
  </main>
}
