import { ArrowRight, Check, Clock, Plus, RotateCcw, Target } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import useLearnerProgress from '../hooks/useLearnerProgress.js'
import { useAvailableTopics, useTopicQuestions } from '../hooks/useQuestionContent.js'
import { workspacePath } from '../utils/paths.js'
import { continueQuestion, practiceDays, relativeDay, suggestQuestions, summariseProgress } from '../utils/progress.js'
import { isFullMarks, partStatus } from '../utils/workspace.js'
import './Dashboard.css'
import './Home.css'

const KIND = {
  retry: { tone: 'bad', icon: RotateCcw, action: 'Retry' },
  focus: { tone: 'part', icon: Target, action: 'Start' },
  new: { tone: 'brand', icon: Plus, action: 'Start' },
  next: { tone: 'neutral', icon: ArrowRight, action: 'Start' },
}

function paperLine(question) {
  const paper = question.paper
  return paper ? `${paper.session} ${paper.year} · Paper ${paper.component} · Question ${question.number}` : ''
}

function ContinueCard({ topic, item, responses, reviews }) {
  const { question } = item
  const subtopic = topic.subtopics.find((entry) => question.subtopicCodes?.includes(entry.code))
  const nextPart = question.parts.find((part) => !isFullMarks(reviews.get(part.id))) || question.parts[0]
  const hasParts = question.parts.length > 1 || question.parts[0]?.label !== 'Answer'
  return <section className="hm-continue" aria-labelledby="continue-heading">
    <div className="hm-continue-top">
      <span className="hm-kicker">Continue</span>
      <span className="hm-when"><Clock size={15} aria-hidden="true" />Last practised · {relativeDay(item.at)}</span>
    </div>
    <div className="hm-continue-text">
      <h2 id="continue-heading">{question.title}</h2>
      <p>{subtopic ? `${subtopic.code} ${subtopic.title} · ` : ''}{paperLine(question)}</p>
    </div>
    {hasParts && <ul className="hm-parts" aria-label="Parts of this question">
      {question.parts.map((part) => {
        const response = responses.get(part.id)
        const status = partStatus({ review: reviews.get(part.id), submitted: response?.submitted, hasWork: Boolean(response?.has_work || response?.typed_work?.trim() || response?.attachments?.length) })
        const label = status.kind === 'draft' ? 'Working saved, not checked yet' : status.label
        return <li key={part.id} className={`db-chip is-${status.tone}`}>{status.kind === 'full' && <Check size={14} strokeWidth={2.6} aria-hidden="true" />}{part.label} {label}</li>
      })}
    </ul>}
    <Link className="db-button hm-continue-button" to={workspacePath(topic.number, question, subtopic?.code)}>
      {hasParts ? `Continue part ${nextPart.label}` : 'Continue question'}<ArrowRight size={18} aria-hidden="true" />
    </Link>
  </section>
}

function SuggestionCard({ topic, suggestion }) {
  const { question, subtopic, kind, label, reason } = suggestion
  const style = KIND[kind]
  const Icon = style.icon
  const difficulty = question.difficulty?.label
  return <Link className="hm-suggestion" to={workspacePath(topic.number, question, subtopic?.code)}>
    <span className={`db-chip is-${style.tone}`}><Icon size={14} aria-hidden="true" />{label}</span>
    <h3>{question.title}</h3>
    <p>{reason}</p>
    <span className="hm-suggestion-foot">
      <span>{[subtopic?.code, difficulty && difficulty.charAt(0).toUpperCase() + difficulty.slice(1), `${question.total_marks} marks`].filter(Boolean).join(' · ')}</span>
      <span className="hm-suggestion-action">{style.action}</span>
    </span>
  </Link>
}

function TopicCard({ topic, questions, summary, days }) {
  const practised = days.filter((day) => day.practised).length
  const triedShare = questions.length ? Math.round((100 * summary.tried) / questions.length) : 0
  return <section className="db-card hm-topic" aria-labelledby="topic-progress-heading">
    <div>
      <h2 id="topic-progress-heading">{topic.title}</h2>
      <p className="db-muted">Your topic so far</p>
    </div>
    <div className="hm-stat">
      <div className="hm-stat-row"><span>Questions tried</span><strong>{summary.tried} of {questions.length}</strong></div>
      <span className="db-bar" aria-hidden="true"><span style={{ width: `${triedShare}%` }} /></span>
    </div>
    <div className="hm-stat">
      <div className="hm-stat-row"><span>Average score</span><strong>{summary.average === null ? '–' : `${summary.average}%`}</strong></div>
      {summary.average !== null && <span className="db-bar" aria-hidden="true"><span style={{ width: `${summary.average}%` }} /></span>}
      <p className="db-muted">{summary.average === null ? 'Check an answer to see your score.' : `Across ${summary.checked} checked ${summary.checked === 1 ? 'answer' : 'answers'}`}</p>
    </div>
    <div className="hm-week">
      <div className="hm-stat-row"><strong>Last 7 days</strong><span>{practised ? `Practised on ${practised} ${practised === 1 ? 'day' : 'days'}` : 'No practice yet'}</span></div>
      <ol aria-label="Days practised in the last 7 days">
        {days.map((day) => {
          const name = day.date.toLocaleDateString(undefined, { weekday: 'long' })
          return <li key={day.date.toISOString()} aria-label={`${day.today ? 'Today' : name}, ${day.practised ? 'practised' : 'not practised'}`} className={day.today ? 'is-today' : undefined}>
            <span className={`hm-day${day.practised ? ' is-on' : ''}`} aria-hidden="true">{day.practised && <Check size={14} strokeWidth={2.8} />}</span>
            <span aria-hidden="true">{day.today ? 'Today' : day.date.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
          </li>
        })}
      </ol>
    </div>
    <Link className="db-button is-quiet" to="/progress">See full progress<ArrowRight size={16} aria-hidden="true" /></Link>
  </section>
}

export default function HomePage() {
  const available = useAvailableTopics()
  const topic = available.firstTopic
  const { questions, loading, error } = useTopicQuestions(topic?.number)
  const progress = useLearnerProgress(topic?.number, questions, loading || available.loading)

  useEffect(() => {
    document.title = 'Math Mate | O Level Mathematics practice'
    window.scrollTo(0, 0)
  }, [])

  const ready = topic && !loading && !progress.loading
  const summary = summariseProgress(questions, progress.responses, progress.reviews)
  const current = ready ? continueQuestion(questions, progress.responses, progress.reviews) : null
  const suggestions = ready ? suggestQuestions(topic, questions, progress.responses, progress.reviews, { exclude: current ? [current.question.id] : [] }) : []
  const isNew = ready && summary.tried === 0

  return <main className="db-page" id="main-content" tabIndex="-1">
    <div className="db-inner">
      <div className="db-head">
        <div className="db-head-text">
          <p className="db-overline">O Level Mathematics · 4024</p>
          <h1>{isNew ? 'Welcome to Math Mate' : 'Welcome back'}</h1>
          <p>{isNew ? 'Pick a question, write your working, then press Check my work. Your tutor helps when you get stuck.' : 'Pick up where you stopped, or try a question chosen for you.'}</p>
        </div>
      </div>

      {(available.error || error) && <div className="db-empty"><h2>Questions could not be loaded</h2><p>Check your connection and try again.</p><button type="button" className="db-button is-quiet" onClick={() => window.location.reload()}>Try again</button></div>}
      {!available.loading && !available.error && !topic && <div className="db-empty"><h2>No questions yet</h2><p>Practice questions will appear here when they are added.</p></div>}
      {progress.error && <p className="db-note" role="status">Your progress could not be loaded. You can still practise every question.</p>}

      {!ready && !available.error && !error && (available.loading || topic) && <div className="hm-grid" role="status" aria-label="Loading your dashboard">
        <div className="hm-main"><div className="db-skeleton hm-skeleton-tall" /><div className="db-skeleton hm-skeleton" /></div>
        <div className="db-skeleton hm-skeleton-side" />
      </div>}

      {ready && <div className="hm-grid">
        <div className="hm-main">
          {current && <ContinueCard topic={topic} item={current} responses={progress.responses} reviews={progress.reviews} />}
          {suggestions.length > 0 && <section className="db-section" aria-labelledby="suggested-heading">
            <div className="db-section-head">
              <div>
                <h2 id="suggested-heading" className="db-section-title">{isNew ? 'Good places to start' : 'Suggested next'}</h2>
                <p>{isNew ? 'Easy first questions from different subtopics.' : 'Chosen from the answers you have checked.'}</p>
              </div>
              <Link className="db-link" to={`/topic/${topic.number}`}>Browse all questions</Link>
            </div>
            <div className="hm-suggestions">{suggestions.map((suggestion) => <SuggestionCard key={suggestion.question.id} topic={topic} suggestion={suggestion} />)}</div>
          </section>}
        </div>
        <aside className="hm-side" aria-label="Your progress">
          <TopicCard topic={topic} questions={questions} summary={summary} days={practiceDays(progress.responseList, progress.reviewList)} />
        </aside>
      </div>}
    </div>
  </main>
}
