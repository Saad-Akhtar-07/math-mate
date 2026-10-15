import { ArrowRight, CircleDashed } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function SubtopicContent({ subtopic, questions = [], loading = false, error = '' }) {
  const topicNumber = subtopic.code.split('.')[0]
  const groups = [
    { key: 'non-calculator', title: 'Non-calculator', questions: questions.filter((question) => !question.paper.calculatorAllowed) },
    { key: 'calculator', title: 'Calculator', questions: questions.filter((question) => question.paper.calculatorAllowed) },
  ].filter((group) => group.questions.length)
  const practicePath = (question, paper) => {
    const params = new URLSearchParams({ subtopic: subtopic.code })
    if (paper) params.set('paper', paper)
    if (question) params.set('question', question.id)
    return `/topic/${topicNumber}/practice?${params}`
  }

  return <article className="subtopic-content question-directory-page" aria-busy={loading}>
    <header className="detail-heading">
      <p>{subtopic.code}</p>
      <h1>{subtopic.title}</h1>
      <span>{loading ? 'Loading questions.' : error ? 'Questions could not be loaded.' : questions.length ? 'Choose a question to begin practising.' : 'Questions for this subtopic are coming soon.'}</span>
    </header>
    {loading ? <div className="subtopic-question-loading" role="status" aria-label="Loading questions">
      <div className="subtopic-question-summary" aria-hidden="true">
        <span className="question-loading-summary" /><span className="question-loading-summary" />
      </div>
      <div className="question-loading-list" aria-hidden="true">
        <span className="question-loading-heading" />
        {Array.from({ length: 5 }, (_, index) => <span className="question-loading-row" key={index}><i /><i /><i /></span>)}
      </div>
      <span className="sr-only">Loading questions from the question bank.</span>
    </div> : questions.length ? <>
      <div className="subtopic-question-summary">
        {groups.map((group) => <Link to={practicePath(null, group.key)} key={group.key}><span>{group.title} ({group.questions.length} {group.questions.length === 1 ? 'question' : 'questions'})</span><ArrowRight size={17} /></Link>)}
      </div>
      {groups.map((group) => <section className="subtopic-question-list" aria-labelledby={`${group.key}-questions-heading`} key={group.key}>
        <div className="directory-section-title"><div><p>PRACTICE</p><h2 id={`${group.key}-questions-heading`}>{group.title}</h2></div><span className="directory-question-count">{group.questions.length} {group.questions.length === 1 ? 'question' : 'questions'}</span></div>
        {group.questions.map((question, index) => <Link className="subtopic-question-link" to={practicePath(question, group.key)} key={question.id}>
          <span className="directory-question-number">{index + 1}</span>
          <span className="directory-question-description"><strong>{question.title}</strong></span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>)}
      </section>)}
    </> : <div className="directory-empty"><CircleDashed size={28} /><h2>{loading ? 'Loading questions' : error ? 'Could not load questions' : 'No questions yet'}</h2><p>{error || (loading ? 'Connecting to the question bank.' : 'This question bank is being prepared.')}</p><Link to="/">Browse topics <ArrowRight size={16} /></Link></div>}
  </article>
}
