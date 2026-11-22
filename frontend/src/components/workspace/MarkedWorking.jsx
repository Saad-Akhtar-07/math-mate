import { Check, X } from 'lucide-react'
import { MISTAKE_TYPE_LABELS, displayLine, markedRows } from '../../utils/markedWorking.js'
import TutorText from '../TutorText.jsx'

const VERDICT_TEXT = { right: 'Correct', wrong: 'Marks lost here' }

function LineMark({ verdict, kind }) {
  const isAddedIssue = kind === 'missing' || kind === 'issue'
  return <span className="ws-line-mark">
    {verdict === 'right' && <Check size={16} strokeWidth={3} aria-hidden="true" />}
    {verdict === 'wrong' && !isAddedIssue && <X size={15} strokeWidth={3} aria-hidden="true" />}
    {verdict === 'wrong' && isAddedIssue && <span className="ws-missing-mark" aria-hidden="true">∧</span>}
    {verdict && <span className="sr-only">{isAddedIssue ? 'A required step needs attention' : VERDICT_TEXT[verdict]}</span>}
  </span>
}

function MistakeNote({ mistakes }) {
  const labels = [...new Set(mistakes.map((mistake) => MISTAKE_TYPE_LABELS[mistake.type] || 'Check this step'))]
  return <p className="ws-line-note">{labels.map((label) => <span className="ws-line-type" key={label}>{label}</span>)}</p>
}

function MarkDetails({ points }) {
  if (!points.length) return null
  return <details className="ws-mark-details">
    <summary>Mark details</summary>
    <div className="ws-mark-codes">
      <span className="ws-marking-label">Examiner codes</span>
      <ul aria-label="Marks earned and lost">
        {points.map((point, index) => <li key={`${point.code}-${index}`} className={point.awarded ? 'is-earned' : 'is-lost'}>
          {point.awarded ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : <X size={13} strokeWidth={3} aria-hidden="true" />}
          <span className="sr-only">{point.awarded ? 'Earned' : 'Lost'}</span>{point.code}
        </li>)}
      </ul>
    </div>
  </details>
}

/**
 * The student's working as the Marker read it, with the marks earned and the lines
 * that lost them. Older attempts have no review and show the lines only.
 */
export default function MarkedWorking({ id, whatIRead, review, fullMarks }) {
  const rows = markedRows(whatIRead, review, fullMarks)
  const points = review?.points || []
  const hasMistakes = rows.some((row) => row.verdict === 'wrong')
  return <div className="ws-marking" id={id}>
    <ol className="ws-marked-lines" aria-label="Your working, as it was read">
      {rows.map((row, index) => row.kind === 'page'
        ? <li key={index} className="ws-marked-page">{row.text}</li>
        : <li key={index} className={`ws-marked-line${row.verdict ? ` is-${row.verdict}` : ''}`}>
          <LineMark verdict={row.verdict} kind={row.kind} />
          <div className="ws-line-body">
            {row.kind === 'missing'
              ? <div className="ws-line-text"><strong>A required step is missing</strong></div>
              : row.kind === 'issue'
                ? <div className="ws-line-text"><strong>A step needs attention</strong></div>
                : <div className="ws-line-text"><TutorText text={displayLine(row.text)} /></div>}
            {row.mistakes.length > 0 && <MistakeNote mistakes={row.mistakes} />}
          </div>
        </li>)}
    </ol>
    {hasMistakes && <p className="ws-marking-foot">Revise the × or ∧ step, then check your work again. Your tutor can give a hint without revealing the answer.</p>}
    <MarkDetails points={points} />
  </div>
}
