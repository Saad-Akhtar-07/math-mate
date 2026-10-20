import { ArrowRight, Check, ChevronRight, PenLine, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import PreviousNextNav from '../components/PreviousNextNav.jsx'
import { syllabus } from '../data/syllabus.js'
import useLearnerProgress from '../hooks/useLearnerProgress.js'
import { useTopicQuestions } from '../hooks/useQuestionContent.js'
import { questionProgress, summariseProgress } from '../utils/progress.js'
import NotFound from './NotFound.jsx'
import './Subtopic.css'

const PAGE_SIZE = 20
const STATUS_FILTERS = [
  ['all', 'All'], ['new', 'Not started'], ['progress', 'In progress'], ['retry', 'Try again'], ['done', 'Full marks'],
]
const DIFFICULTY_LEVEL = { easy: 1, medium: 2, hard: 3 }

function paperLabel(paper) {
  if (!paper) return ''
  return `${paper.session} ${paper.year} · Paper ${paper.component} · ${paper.calculatorAllowed ? 'Calculator' : 'Non-calculator'}`
}

function StatusIcon({ status }) {
  if (status === 'done') return <span className="sl-status-icon is-good" aria-hidden="true"><Check size={18} strokeWidth={2.6} /></span>
  if (status === 'retry') return <span className="sl-status-icon is-bad" aria-hidden="true"><RotateCcw size={17} /></span>
  if (status === 'progress') return <span className="sl-status-icon is-part" aria-hidden="true"><PenLine size={17} /></span>
  return <span className="sl-status-icon is-new" aria-hidden="true" />
}

function Difficulty({ label }) {
  const level = DIFFICULTY_LEVEL[label]
  if (!level) return <span className="sl-difficulty" />
  return <span className="sl-difficulty">
    <span className="sl-difficulty-bars" aria-hidden="true">{[1, 2, 3].map((step) => <i key={step} className={step <= level ? 'is-on' : ''} />)}</span>
    {label.charAt(0).toUpperCase() + label.slice(1)}
  </span>
}

export default function SubtopicPage() {
  const { topicNumber, subtopicNumber } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [limit, setLimit] = useState(PAGE_SIZE)
  const topic = syllabus.find((item) => item.number === topicNumber)
  const subtopic = topic?.subtopics.find((item) => item.code === subtopicNumber)
  const { questions: topicQuestions, loading, error } = useTopicQuestions(topic?.number)
  const progress = useLearnerProgress(topic?.number, topicQuestions, loading)

  useEffect(() => {
    if (subtopic) document.title = `${subtopic.code} ${subtopic.title} | Math Mate`
    window.scrollTo(0, 0)
    setLimit(PAGE_SIZE)
  }, [subtopic])

  if (!topic || !subtopic) return <NotFound />

  const statusFilter = searchParams.get('status') || 'all'
  const paperFilter = searchParams.get('paper') || 'all'
  const difficultyFilter = searchParams.get('difficulty') || 'all'
  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams)
    if (value && value !== 'all') next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
    setLimit(PAGE_SIZE)
  }
  const clearFilters = () => { setSearchParams(new URLSearchParams(), { replace: true }); setLimit(PAGE_SIZE) }

  const subtopicQuestions = topicQuestions.filter((question) => question.subtopicCodes?.includes(subtopic.code))
  const summary = summariseProgress(subtopicQuestions, progress.responses, progress.reviews)
  const items = subtopicQuestions.map((question) => ({ question, progress: questionProgress(question, progress.responses, progress.reviews) }))
  const matchesPaperAndDifficulty = ({ question }) => (paperFilter === 'all' || (paperFilter === 'calculator') === Boolean(question.paper?.calculatorAllowed))
    && (difficultyFilter === 'all' || question.difficulty?.label === difficultyFilter)
  const narrowed = items.filter(matchesPaperAndDifficulty)
  const statusCounts = Object.fromEntries(STATUS_FILTERS.map(([key]) => [key, key === 'all' ? narrowed.length : narrowed.filter((item) => item.progress.status === key).length]))
  const filtered = narrowed.filter((item) => statusFilter === 'all' || item.progress.status === statusFilter)
  const visible = filtered.slice(0, limit)
  const filtersActive = statusFilter !== 'all' || paperFilter !== 'all' || difficultyFilter !== 'all'

  // The workspace steps through the same list: same subtopic, paper and difficulty.
  const workspacePath = (question) => {
    const params = new URLSearchParams({ subtopic: subtopic.code })
    if (paperFilter !== 'all') params.set('paper', paperFilter)
    if (difficultyFilter !== 'all') params.set('difficulty', difficultyFilter)
    params.set('question', question.id)
    return `/topic/${topic.number}/practice?${params}`
  }
  const firstWith = (status) => filtered.find((item) => item.progress.status === status)
  const nextItem = firstWith('progress') || firstWith('new') || firstWith('retry') || filtered[0]

  const facts = [`${subtopicQuestions.length} ${subtopicQuestions.length === 1 ? 'question' : 'questions'}`]
  if (summary.tried) facts.push(`You have tried ${summary.tried}`)
  if (summary.average !== null) facts.push(`Average score ${summary.average}%`)

  return <main className="sl-page" id="main-content" tabIndex="-1">
    <div className="sl-inner">
      <nav aria-label="Breadcrumb"><ol className="sl-breadcrumb">
        <li><Link to="/practice">Practice</Link></li>
        <li aria-hidden="true"><ChevronRight size={14} /></li>
        <li><Link to={`/topic/${topic.number}`}>{topic.title}</Link></li>
        <li aria-hidden="true"><ChevronRight size={14} /></li>
        <li aria-current="page">{subtopic.code} {subtopic.title}</li>
      </ol></nav>

      <header className="sl-head">
        <div className="sl-head-text">
          <div className="sl-title-row"><span className="sl-code">{subtopic.code}</span><h1>{subtopic.title}</h1></div>
          <p>{loading ? 'Loading questions…' : error ? 'Questions could not be loaded.' : subtopicQuestions.length ? facts.join(' · ') : 'Questions for this subtopic are coming soon.'}</p>
        </div>
        {nextItem && <Link className="sl-start" to={workspacePath(nextItem.question)}>
          {nextItem.progress.status === 'progress' ? 'Continue question' : 'Start next question'}<ArrowRight size={18} aria-hidden="true" />
        </Link>}
      </header>

      {subtopic.outcomes?.length > 0 && <details className="sl-outcomes">
        <summary>What the syllabus expects · {subtopic.outcomes.length} learning {subtopic.outcomes.length === 1 ? 'outcome' : 'outcomes'}</summary>
        <ol>{subtopic.outcomes.map((outcome) => <li key={outcome}>{outcome}</li>)}</ol>
      </details>}

      {progress.error && <p className="sl-note" role="status">Your progress could not be loaded. You can still practise every question.</p>}

      {subtopicQuestions.length > 0 && <div className="sl-filters">
        <div className="sl-status-filter" role="group" aria-label="Show questions">
          {STATUS_FILTERS.map(([key, label]) => <button type="button" key={key} aria-pressed={statusFilter === key} onClick={() => updateFilter('status', key)}>
            {label} <span>{statusCounts[key]}</span>
          </button>)}
        </div>
        <div className="sl-selects">
          <label>Paper
            <select value={paperFilter} onChange={(event) => updateFilter('paper', event.target.value)}>
              <option value="all">All papers</option><option value="non-calculator">Non-calculator</option><option value="calculator">Calculator</option>
            </select>
          </label>
          <label>Difficulty
            <select value={difficultyFilter} onChange={(event) => updateFilter('difficulty', event.target.value)}>
              <option value="all">Any</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
            </select>
          </label>
        </div>
      </div>}

      {loading ? <div className="sl-list" role="status" aria-label="Loading questions">
        {Array.from({ length: 5 }, (_, index) => <div className="sl-row-skeleton" key={index}><i /><span><i /><i /></span></div>)}
      </div>
        : error ? <div className="sl-empty"><h2>Questions could not be loaded</h2><p>{error}</p><button type="button" className="sl-button" onClick={() => window.location.reload()}>Try again</button></div>
          : !subtopicQuestions.length ? <div className="sl-empty"><h2>No questions yet</h2><p>Questions for this subtopic will appear here when they are added.</p></div>
            : !filtered.length ? <div className="sl-empty"><h2>No questions match these filters</h2><button type="button" className="sl-button" onClick={clearFilters}>Show all questions</button></div>
              : <section className="sl-list" aria-label="Questions">
                <ul>{visible.map(({ question, progress: item }) => <li key={question.id}>
                  <Link className="sl-row" to={workspacePath(question)}>
                    <StatusIcon status={item.status} />
                    <span className="sl-row-main"><strong>{question.title}</strong><span>{paperLabel(question.paper)}{question.parts.length > 1 ? ` · ${question.parts.length} parts` : ''}</span></span>
                    <Difficulty label={question.difficulty?.label} />
                    <span className={`sl-row-status is-${item.tone}`}>{item.label}</span>
                    <ChevronRight size={18} aria-hidden="true" className="sl-row-chevron" />
                  </Link>
                </li>)}</ul>
                <div className="sl-list-foot">
                  <span>Showing {visible.length} of {filtered.length}</span>
                  {visible.length < filtered.length && <button type="button" className="sl-button" onClick={() => setLimit((current) => current + PAGE_SIZE)}>Show more questions</button>}
                  {filtersActive && <button type="button" className="sl-link-button" onClick={clearFilters}>Clear filters</button>}
                </div>
              </section>}

      <PreviousNextNav code={subtopic.code} />
    </div>
  </main>
}
