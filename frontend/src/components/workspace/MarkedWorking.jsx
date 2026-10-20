import { Check, X } from 'lucide-react'
import { MISTAKE_TYPE_LABELS, displayLine, markedRows } from '../../utils/markedWorking.js'
import TutorText from '../TutorText.jsx'

const VERDICT_TEXT = { right: 'Correct', wrong: 'Marks lost here' }

function LineMark({ verdict }) {
  return <span className="ws-line-mark">
    {verdict === 'right' && <Check size={13} strokeWidth={3} aria-hidden="true" />}
    {verdict === 'wrong' && <X size={13} strokeWidth={3} aria-hidden="true" />}
    {verdict && <span className="sr-only">{VERDICT_TEXT[verdict]}</span>}
  </span>
}

function MistakeNote({ mistake }) {
  return <p className="ws-line-note">
    <span className="ws-line-type">{MISTAKE_TYPE_LABELS[mistake.type] || 'Mistake'}</span>
    {mistake.marks_lost?.length > 0 && <span className="ws-line-lost">Lost {mistake.marks_lost.join(', ')}</span>}
  </p>
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
    {points.length > 0 && <div className="ws-mark-codes">
      <span className="ws-marking-label">Marks</span>
      <ul aria-label="Marks earned and lost">
        {points.map((point, index) => <li key={`${point.code}-${index}`} className={point.awarded ? 'is-earned' : 'is-lost'}>
          {point.awarded ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : <X size={13} strokeWidth={3} aria-hidden="true" />}
          <span className="sr-only">{point.awarded ? 'Earned' : 'Lost'}</span>{point.code}
        </li>)}
      </ul>
    </div>}
    <ol className="ws-marked-lines" aria-label="Your working, as it was read">
      {rows.map((row, index) => row.kind === 'page'
        ? <li key={index} className="ws-marked-page">{row.text}</li>
        : <li key={index} className={`ws-marked-line${row.verdict ? ` is-${row.verdict}` : ''}`}>
          <LineMark verdict={row.verdict} />
          <div className="ws-line-body">
            {row.kind === 'missing'
              ? <div className="ws-line-text"><strong>Missing step</strong>{row.text && <> · <TutorText text={row.text} /></>}</div>
              : <div className="ws-line-text"><TutorText text={displayLine(row.text)} /></div>}
            {row.mistakes.map((mistake, number) => <MistakeNote key={number} mistake={mistake} />)}
          </div>
        </li>)}
    </ol>
    {hasMistakes && <p className="ws-marking-foot">Your tutor can help you fix each marked step, one at a time.</p>}
  </div>
}
