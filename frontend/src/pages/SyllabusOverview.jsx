import { ArrowRight, BookOpenCheck, ListFilter, PenLine } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import TopicIndex from '../components/TopicIndex.jsx'
import { syllabus } from '../data/syllabus.js'
import { useQuestionSummary } from '../hooks/useQuestionContent.js'

export default function SyllabusOverview() {
  const { summary, loading, error } = useQuestionSummary()
  const firstTopic = syllabus.find((topic) => (summary?.topic_counts?.[topic.number] || 0) > 0)
  useEffect(() => {
    document.title = 'Math Mate | O Level Mathematics practice'
    window.scrollTo(0, 0)
  }, [])

  return <main id="main-content" tabIndex="-1" className="mathmate-home">
    <section className="overview-hero">
      <div className="hero-copy">
        <div className="overview-kicker">CAMBRIDGE O LEVEL MATHEMATICS · 4024</div>
        <h1>Maths practice,<br /><em>made clearer.</em></h1>
        <p>Choose a topic, focus on a skill, and work through exam questions in one calm, simple workspace.</p>
        <div className="hero-actions"><a className="hero-primary" href="#topics">Browse topics <ArrowRight size={18} /></a>{firstTopic && <Link className="hero-secondary" to={`/topic/${firstTopic.number}/practice`}>Start practising <ArrowRight size={16} /></Link>}</div>
      </div>
      <div className="hero-showcase" aria-label="How Math Mate works">
        <p>YOUR PRACTICE SPACE</p>
        <h2>Find a question.<br />Work it through.</h2>
        <div className="showcase-steps"><span><BookOpenCheck size={19} /> Choose a topic</span><span><ListFilter size={19} /> Focus your practice</span><span><PenLine size={19} /> Show your working</span></div>
      </div>
    </section>
    <section className="syllabus-index-section" id="topics" aria-labelledby="explore-heading">
      <div className="section-intro"><div><p>QUESTION BANK</p><h2 id="explore-heading">Explore topics</h2></div></div>
      {error && <p className="content-load-error" role="alert">Question counts could not be loaded. {error}</p>}
      <TopicIndex topics={syllabus} counts={summary?.topic_counts || {}} loading={loading} error={Boolean(error)} />
    </section>
  </main>
}
