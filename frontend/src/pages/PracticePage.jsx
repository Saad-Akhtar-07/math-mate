import { ArrowRight, ChevronRight } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { syllabus } from '../data/syllabus.js'
import useLearnerProgress from '../hooks/useLearnerProgress.js'
import { useAvailableTopics, useTopicQuestions } from '../hooks/useQuestionContent.js'
import { workspacePath } from '../utils/paths.js'
import { focusSubtopic, subtopicStats, suggestQuestions, summariseProgress } from '../utils/progress.js'
import NotFound from './NotFound.jsx'
import './Dashboard.css'
import './Practice.css'

export default function PracticePage() {
  const { topicNumber } = useParams()
  const topic = syllabus.find((item) => item.number === topicNumber)
  const available = useAvailableTopics()
  const { questions, loading, error } = useTopicQuestions(topic?.number)
  const progress = useLearnerProgress(topic?.number, questions, loading)

  useEffect(() => {
    if (topic) document.title = `${topic.title} practice | Math Mate`
    window.scrollTo(0, 0)
  }, [topic])

  if (!topic) return <NotFound />

  const stats = subtopicStats(topic, questions, progress.responses, progress.reviews)
  const summary = summariseProgress(questions, progress.responses, progress.reviews)
  const focus = focusSubtopic(stats)
  const suggestion = suggestQuestions(topic, questions, progress.responses, progress.reviews, { limit: 1 })[0]
  const facts = [`${questions.length} questions`, `${topic.subtopics.length} subtopics`]
  if (summary.tried) facts.push(`You have tried ${summary.tried}`)
  const comingSoon = available.topics.some((item) => !item.count && item.topic.number !== topic.number)

  return <main className="db-page" id="main-content" tabIndex="-1">
    <div className="db-inner">
      <div className="db-head">
        <div className="db-head-text">
          <h1>Practice</h1>
          <p>Real Cambridge 4024 past-paper questions, sorted by syllabus subtopic.</p>
        </div>
        {suggestion && <Link className="db-button" to={workspacePath(topic.number, suggestion.question, suggestion.subtopic?.code)}>
          Start a suggested question<ArrowRight size={18} aria-hidden="true" />
        </Link>}
      </div>

      <div className="pr-topics-wrap">
        <nav className="pr-topics" aria-label="Syllabus topics">
          {available.topics.map(({ topic: item, count }) => item.number === topic.number
            ? <Link key={item.number} className="pr-topic is-current" to={`/topic/${item.number}`} aria-current="page"><span>{item.number}</span>{item.title}</Link>
            : count > 0 || available.loading
              ? <Link key={item.number} className="pr-topic" to={`/topic/${item.number}`}><span>{item.number}</span>{item.title}</Link>
              : <span key={item.number} className="pr-topic is-soon" aria-disabled="true"><span>{item.number}</span>{item.title}<span className="sr-only"> (coming soon)</span></span>)}
        </nav>
        {comingSoon && !available.loading && <p className="db-muted">Other topics are coming soon.</p>}
      </div>

      {progress.error && <p className="db-note" role="status">Your progress could not be loaded. You can still practise every question.</p>}

      <section className="pr-topic-card" aria-labelledby="topic-heading">
        <div className="pr-topic-card-head">
          <div>
            <h2 id="topic-heading">{topic.title}</h2>
            <p className="db-muted">{loading ? 'Loading questions…' : error ? 'Questions could not be loaded.' : questions.length ? facts.join(' · ') : 'Questions for this topic are coming soon.'}</p>
          </div>
          {summary.checked > 0 && <span className="pr-legend"><i aria-hidden="true" />Score on checked answers</span>}
        </div>
        <ul className="pr-subtopics">
          {stats.map(({ subtopic, questions: own, tried, average, checked }) => <li key={subtopic.code} className={focus?.subtopic.code === subtopic.code ? 'is-focus' : undefined}>
            <Link className="pr-subtopic" to={`/topic/${topic.number}/${subtopic.code}`}>
              <span className="pr-code">{subtopic.code}</span>
              <span className="pr-subtopic-main">
                <span className="pr-subtopic-title"><strong>{subtopic.title}</strong>{focus?.subtopic.code === subtopic.code && <span className="db-focus">Focus area</span>}</span>
                <span>{loading ? 'Loading…' : own.length ? `${own.length} ${own.length === 1 ? 'question' : 'questions'}` : 'Questions coming soon'}</span>
              </span>
              <span className="pr-subtopic-progress">
                <span className="db-bar" aria-hidden="true">{checked > 0 && <span style={{ width: `${average}%` }} />}</span>
                <span className="pr-subtopic-score">{tried ? `${tried} tried${average !== null ? ` · ${average}%` : ''}` : 'Not started'}</span>
              </span>
              <ChevronRight size={18} aria-hidden="true" className="pr-chevron" />
            </Link>
          </li>)}
        </ul>
      </section>
    </div>
  </main>
}
