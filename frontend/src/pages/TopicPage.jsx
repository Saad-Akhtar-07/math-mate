import { ArrowRight } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import Breadcrumbs from '../components/Breadcrumbs.jsx'
import ReaderShell from '../components/ReaderShell.jsx'
import { syllabus } from '../data/syllabus.js'
import { useQuestionSummary } from '../hooks/useQuestionContent.js'
import NotFound from './NotFound.jsx'

export default function TopicPage() {
  const { topicNumber } = useParams()
  const topic = syllabus.find((item) => item.number === topicNumber)
  const { summary, loading, error } = useQuestionSummary()
  const isReady = (summary?.topic_counts?.[topicNumber] || 0) > 0

  useEffect(() => {
    if (topic) document.title = `${topic.title} | Math Mate`
    window.scrollTo(0, 0)
  }, [topic])

  if (!topic) return <NotFound />

  return <ReaderShell topic={topic}>
    <div className="reader-main topic-directory-page">
      <Breadcrumbs topic={topic} />
      <header className="topic-page-heading">
        <p>MATHEMATICS · 4024</p>
        <h1>{topic.title}</h1>
        <span>{loading ? 'Checking available questions.' : error ? 'Question counts could not be loaded.' : isReady ? 'Choose a subtopic or browse the full question bank.' : 'Questions for this topic are coming soon.'}</span>
        {error && <p className="content-load-error" role="alert">{error}</p>}
        {isReady && <Link className="topic-practice-link" to={`/topic/${topic.number}/practice`}>Browse questions <ArrowRight size={17} aria-hidden="true" /></Link>}
      </header>
      <section className="subtopic-directory" aria-labelledby="subtopics-heading">
        <div className="directory-section-title"><div><p>EXPLORE BY SKILL</p><h2 id="subtopics-heading">Subtopics</h2></div></div>
        {topic.subtopics.map((subtopic) => {
          const count = summary?.subtopic_counts?.[subtopic.code] || 0
          return <Link key={subtopic.code} to={`/topic/${topic.number}/${subtopic.code}`}>
            <span>{subtopic.code}</span>
            <div><h3>{subtopic.title}</h3><p>{loading ? 'Checking questions' : error ? 'Question bank unavailable' : count ? 'Practice questions available' : 'Questions coming soon'}</p></div>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        })}
      </section>
    </div>
  </ReaderShell>
}
