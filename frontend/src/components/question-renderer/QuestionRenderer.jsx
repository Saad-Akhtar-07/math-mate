import ContentBlockRenderer from './ContentBlockRenderer'
import MathText from './MathText'
import { calculatedMarks, classificationValue, difficultyLabel } from '../../utils/questionBank'

function Prompt({ blocks = [] }) {
  if (!Array.isArray(blocks)) return <div className="unsupported-block">Malformed prompt</div>
  return blocks.map((block, index) => <ContentBlockRenderer block={block} key={block.id || index} />)
}

function Part({ part, depth = 0 }) {
  return (
    <div className={`exam-part depth-${Math.min(depth, 3)}`}>
      <div className="part-row">
        <span className="part-label">{part.label || ''}</span>
        <div className="part-prompt"><Prompt blocks={part.prompt} /></div>
        {part.marks !== undefined && part.marks !== '' && <span className="part-marks">[{part.marks}]</span>}
      </div>
      {!!part.parts?.length && <div className="nested-parts">{part.parts.map((child, index) => <Part part={child} depth={depth + 1} key={child.id || index} />)}</div>}
    </div>
  )
}

export default function QuestionRenderer({ question, collection = {} }) {
  if (!question) return <div className="empty-state"><div className="empty-icon">Q</div><h2>No question selected</h2><p>Choose a question from the list or import a question bank.</p></div>
  const marks = question.total_marks ?? calculatedMarks(question)
  const topic = classificationValue(question, 'topic')
  const subtopic = classificationValue(question, 'subtopic')
  const level = difficultyLabel(question)
  const calculator = collection.source?.calculator_allowed ?? collection.calculator
  return (
    <article className="exam-paper">
      <header className="paper-header">
        <div>
          <span className="eyebrow">Question preview</span>
          <h1>{question.title || `Question ${question.number ?? ''}`}</h1>
        </div>
        <div className="paper-code">{collection.id || 'QUESTION BANK'}</div>
      </header>
      <div className="preview-meta">
        {[topic, subtopic, level, calculator === false ? 'Non-calculator' : calculator === true ? 'Calculator' : null].filter(Boolean).map((item) => <span key={item}>{item}</span>)}
      </div>
      <div className="question-body">
        <div className="question-number">{question.number ?? '—'}</div>
        <div className="root-prompt"><Prompt blocks={question.prompt} /></div>
      </div>
      <div className="parts-list">{(question.parts || []).map((part, index) => <Part part={part} key={part.id || index} />)}</div>
      {question.answer && <div className="standalone-answer"><strong>Answer</strong><MathText>{question.answer}</MathText></div>}
      <footer className="paper-footer"><span>Preview only</span><strong>[Total: {marks}]</strong></footer>
    </article>
  )
}
