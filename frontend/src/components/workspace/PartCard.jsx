import { ArrowRight, Camera, Check, ChevronDown, Eye, ImageUp, ListChecks, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getQuestionPartSolution } from '../../api/content.js'
import { getResponseSubmissions } from '../../api/submissions.js'
import useMediaQuery from '../../hooks/useMediaQuery.js'
import { isFullMarks, previewText } from '../../utils/workspace.js'
import InlineContent from '../notes/InlineContent.jsx'
import MathText from '../question-renderer/MathText.jsx'
import SolutionImage from '../SolutionImage.jsx'
import SolutionUploadQueue from '../SolutionUploadQueue.jsx'
import TutorText from '../TutorText.jsx'
import MarkedWorking from './MarkedWorking.jsx'
import QuestionBlock from './QuestionBlock.jsx'

const MAX_PAGES = 4

const mathsTools = [
  { id: 'power', label: <>x<sup>2</sup></>, name: 'Add a power' },
  { id: 'root', label: '√', name: 'Add a square root' },
  { id: 'fraction', label: 'a/b', name: 'Add a fraction' },
  { id: 'multiply', label: '×', name: 'Add a multiplication sign' },
  { id: 'divide', label: '÷', name: 'Add a division sign' },
  { id: 'probability', label: 'P( )', name: 'Add probability notation' },
]

// Text to insert for a maths key, and where the cursor goes afterwards.
function mathsInsertion(toolId, selected) {
  if (toolId === 'power') {
    const text = selected ? `${selected}^2` : '^2'
    return { text, cursor: text.length }
  }
  if (toolId === 'root') return { text: `sqrt(${selected})`, cursor: selected ? selected.length + 6 : 5 }
  if (toolId === 'fraction') {
    const text = selected ? `(${selected})/()` : '()/()'
    return { text, cursor: selected ? text.length - 1 : 1 }
  }
  if (toolId === 'probability') return { text: `P(${selected})`, cursor: selected ? selected.length + 3 : 2 }
  const text = toolId === 'multiply' ? ' × ' : ' ÷ '
  return { text, cursor: text.length }
}

function marksLabel(marks) {
  if (marks === undefined || marks === null) return ''
  return `${marks} ${Number(marks) === 1 ? 'mark' : 'marks'}`
}

export function StatusChip({ status }) {
  return <span className={`ws-chip is-${status.tone}`}>
    {status.kind === 'full' && <Check size={14} strokeWidth={2.6} aria-hidden="true" />}
    {status.kind === 'checking' && <LoaderCircle className="spin" size={14} aria-hidden="true" />}
    {status.label}
  </span>
}

const ACCEPTED_IMAGES = 'image/jpeg,image/png,image/webp'
const PHOTO_HELP = 'JPEG, PNG or WebP. Up to 4 pages, 10 MB each.'

/**
 * Photos of written working. On touch devices: Take photo opens the rear camera
 * directly (capture="environment"; one page per shot) and Upload opens the gallery.
 * Elsewhere one button opens the file picker. All paths feed the same upload queue.
 */
function PhotoPicker({ disabled, uploading, onPick }) {
  const touch = useMediaQuery('(pointer: coarse)')
  const cameraRef = useRef(null)
  const filesRef = useRef(null)
  const pick = (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length) onPick(files)
    event.target.value = ''
  }
  const icon = (Icon) => uploading ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Icon size={17} aria-hidden="true" />
  return <div className="ws-photo-actions">
    <input ref={filesRef} className="sr-only" type="file" aria-label="Upload solution pages" disabled={disabled}
      accept={ACCEPTED_IMAGES} multiple onChange={pick} />
    {touch ? <>
      <input ref={cameraRef} className="sr-only" type="file" aria-label="Take a photo of your working" disabled={disabled}
        accept={ACCEPTED_IMAGES} capture="environment" onChange={pick} />
      <button type="button" className="ws-photo-button is-primary" disabled={disabled} title={PHOTO_HELP} onClick={() => cameraRef.current?.click()}>
        {icon(Camera)}Take photo
      </button>
      <button type="button" className="ws-photo-button" disabled={disabled} title={PHOTO_HELP} onClick={() => filesRef.current?.click()}>
        {icon(ImageUp)}Upload
      </button>
    </> : <button type="button" className="ws-photo-button" disabled={disabled} title={PHOTO_HELP} onClick={() => filesRef.current?.click()}>
      {icon(Camera)}Add photo of working
    </button>}
  </div>
}

function WorkingEditor({ part, value, ready, onChange, uploadsEnabled, pageCount, uploading, onPickPhotos }) {
  const textareaRef = useRef(null)
  const insertMaths = (toolId) => {
    if (!ready) return
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? value.length
    const end = textarea?.selectionEnd ?? value.length
    const { text, cursor } = mathsInsertion(toolId, value.slice(start, end))
    onChange(`${value.slice(0, start)}${text}${value.slice(end)}`)
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + cursor, start + cursor)
    })
  }
  const photoDisabled = !ready || pageCount >= MAX_PAGES || uploading
  return <div className="ws-editor">
    <div className="ws-editor-input">
      <textarea ref={textareaRef} id={`${part.id}-answer`} rows="5" maxLength="20000" spellCheck="false" disabled={!ready}
        value={value} onChange={(event) => onChange(event.target.value)} placeholder="Write each step on a new line" />
      {part.answer_suffix && <span className="ws-answer-suffix"><MathText>{part.answer_suffix}</MathText></span>}
    </div>
    <div className="ws-editor-tools">
      <div className="ws-maths-keys" role="group" aria-label="Maths input tools">
        {mathsTools.map((tool) => <button type="button" key={tool.id} disabled={!ready} title={tool.name} aria-label={tool.name} onClick={() => insertMaths(tool.id)}>{tool.label}</button>)}
      </div>
      {uploadsEnabled && <PhotoPicker disabled={photoDisabled} uploading={uploading} onPick={onPickPhotos} />}
    </div>
  </div>
}

function SavedPages({ attachments, ready, onRemove }) {
  if (!attachments.length) return null
  return <div className="ws-pages">
    <p className="ws-page-count">{attachments.length} / {MAX_PAGES} pages</p>
    <div className="solution-attachments" aria-label="Attached solution images">
      {attachments.map((attachment) => <figure key={attachment.id}>
        <SolutionImage fileId={attachment.file_id} filename={attachment.original_filename} pageNumber={attachment.position} />
        <figcaption><span title={attachment.original_filename}>Page {attachment.position}</span>
          <button type="button" disabled={!ready} aria-label={`Remove ${attachment.original_filename}`} onClick={() => onRemove(attachment.id)}><Trash2 size={14} aria-hidden="true" /></button>
        </figcaption>
      </figure>)}
    </div>
  </div>
}

function SlowNotice() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 10000)
    return () => clearTimeout(timer)
  }, [])
  return <span>{slow ? 'This is taking longer than usual. You can keep working while it finishes.' : 'This can take a few seconds.'}</span>
}

// The outcome of the latest check, shown beside the working. Feedback itself is in the tutor column.
// With marks lost, how the work was marked opens by default: it shows which lines lost them.
function ResultStrip({ review, checking, error, assisted, onNext, nextLabel }) {
  const [showMarking, setShowMarking] = useState(null)
  if (checking) {
    return <div className="ws-result is-brand" role="status">
      <LoaderCircle className="spin" size={20} aria-hidden="true" />
      <div><strong>Checking your working…</strong><SlowNotice /></div>
    </div>
  }
  if (error) return <div className="ws-result is-bad" role="alert"><RotateCcw size={20} aria-hidden="true" /><div><strong>Your work could not be checked</strong><span>{error}</span></div></div>
  if (!review) return null
  if (review.status === 'failed') {
    return <div className="ws-result is-bad" role="alert"><RotateCcw size={20} aria-hidden="true" /><div>
      <strong>This check did not finish</strong>
      <span>{review.error_message || 'Please try again.'}{review.can_retry ? '' : ' Change your working, then check again.'}</span>
    </div></div>
  }
  if (review.status !== 'completed') return null
  if (review.outcome !== 'marked') {
    return <div className="ws-result is-part" role="status"><Eye size={20} aria-hidden="true" /><div>
      <strong>Attempt {review.attempt_number} was not marked</strong>
      <span><TutorText text={review.feedback} /></span>
    </div></div>
  }
  const full = isFullMarks(review)
  const tone = full ? 'good' : review.marks_awarded > 0 ? 'part' : 'bad'
  const open = showMarking ?? Boolean(review.review && !full)
  const panelId = `${review.question_part_id}-marking`
  return <div className={`ws-result is-${tone}`}>
    <span className="ws-result-icon" aria-hidden="true">{full ? <Check size={18} strokeWidth={2.6} /> : <RotateCcw size={18} />}</span>
    <div>
      <strong>{review.marks_awarded} of {review.marks_maximum} marks</strong>
      <span>Attempt {review.attempt_number} · {assisted ? 'With help' : 'Done without help'}{full ? '' : ' · Your tutor has feedback'}</span>
    </div>
    <div className="ws-result-actions">
      {review.what_i_read && <button type="button" className="ws-small-button" aria-expanded={open} aria-controls={panelId} onClick={() => setShowMarking(!open)}>
        {review.review ? <><ListChecks size={15} aria-hidden="true" />How it was marked</> : <><Eye size={15} aria-hidden="true" />What I read</>}
      </button>}
      {full && onNext && <button type="button" className="ws-small-button is-primary" onClick={onNext}>{nextLabel}<ArrowRight size={15} aria-hidden="true" /></button>}
    </div>
    {open && review.what_i_read && <MarkedWorking id={panelId} whatIRead={review.what_i_read} review={review.review} fullMarks={full} />}
  </div>
}

function MarkScheme({ partId }) {
  const [scheme, setScheme] = useState(null)
  const [state, setState] = useState('loading')
  useEffect(() => {
    let cancelled = false
    getQuestionPartSolution(partId).then((data) => {
      if (!cancelled) { setScheme(data); setState('loaded') }
    }).catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [partId])
  return <div className="mark-scheme-panel" id={`${partId}-scheme`}>
    {state === 'loading' && <p className="ws-panel-note" role="status">Loading mark scheme…</p>}
    {state === 'error' && <p className="ws-panel-note" role="alert">The mark scheme could not be loaded.</p>}
    {scheme && <>
      <div className="scheme-answer"><span>Answer</span><p><InlineContent content={scheme.answer} /></p></div>
      {scheme.marking_points.length > 0 && <div className="scheme-points"><span>How marks are awarded</span><ol>{scheme.marking_points.map((point, index) => <li key={`${point.code}-${index}`}><strong>{point.code}</strong><p><InlineContent content={point.text} /></p></li>)}</ol></div>}
    </>}
  </div>
}

function EarlierAttempts({ partId, submitted }) {
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getResponseSubmissions(partId).then((data) => {
      if (!cancelled) { setItems(data.submissions); setCursor(data.next_cursor) }
    }).catch((failure) => { if (!cancelled) setError(failure.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [partId, submitted])
  const loadMore = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getResponseSubmissions(partId, cursor)
      setItems((current) => [...current, ...data.submissions])
      setCursor(data.next_cursor)
    } catch (failure) { setError(failure.message) }
    finally { setLoading(false) }
  }
  return <div className="ws-attempts">
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Loading earlier attempts…</p>}
    {!loading && !items.length && !error && <p>No earlier attempts yet.</p>}
    {items.map((item) => <article key={item.id}>
      <small>Submitted {new Date(item.submitted_at).toLocaleString()}</small>
      {item.typed_work && <pre>{item.typed_work}</pre>}
      {!!item.attachments?.length && <div className="solution-attachments" aria-label="Submitted solution pages">{item.attachments.map((page) => <figure key={page.file_id}><SolutionImage fileId={page.file_id} filename={page.original_filename} pageNumber={page.position} /><figcaption>Page {page.position}</figcaption></figure>)}</div>}
    </article>)}
    {cursor && <button type="button" className="ws-small-button" disabled={loading} onClick={loadMore}>Load earlier attempts</button>}
  </div>
}

/**
 * What the main button does for this part:
 *  - check: submit and AI-mark (one action; marking submits the work)
 *  - submit: save an attempt without AI (AI off, or a graph/diagram answer)
 *  - local: questions served from bundled data; work is only kept on this device
 */
function primaryAction({ mode, review, submitted, checking, saveState }) {
  if (mode === 'submit') {
    return { label: saveState === 'submitting' ? 'Submitting…' : submitted ? 'Submitted' : 'Submit answer', blocked: submitted || saveState === 'submitting', busy: saveState === 'submitting' }
  }
  if (checking) return { label: 'Checking…', blocked: true, busy: true }
  if (submitted && review && !(review.status === 'failed' && review.can_retry)) {
    const full = isFullMarks(review)
    return { label: full ? 'Checked' : 'Check again', blocked: true, hint: full ? '' : 'Change your working to check again' }
  }
  if (submitted && review?.status === 'failed') return { label: 'Try checking again', blocked: false }
  return { label: 'Check my work', blocked: false }
}

export default function PartCard({
  part, prompt, expanded, status, onExpand, mode, aiMarkable,
  answer, attachments, saveState, saveMessage, ready, submitted, uploadsEnabled, showHistory,
  review, checking, checkError, assisted, tutorBusy, onNext, nextLabel,
  onAnswerChange, onCheck, onSubmit, onActivate,
  onUpload, onRemoveAttachment, uploadQueue = [], uploadBusy, uploadBlocked, onRetryUpload, onDiscardUpload,
}) {
  const [panel, setPanel] = useState('')
  const pendingPhotos = uploadQueue.filter((item) => item.status !== 'saved').length
  const hasWork = Boolean(answer.trim() || attachments.length)
  const hasUploadError = uploadQueue.some((item) => item.status === 'failed' && item.error === saveMessage)
  const togglePanel = (name) => setPanel((current) => (current === name ? '' : name))

  if (!expanded) {
    return <section className="ws-part is-collapsed" aria-label={`Part ${part.label}`}>
      <button type="button" className="ws-part-summary" aria-expanded="false" onClick={onExpand}>
        <span className="ws-part-label">{part.label}</span>
        <span className="ws-part-preview"><MathText>{previewText(prompt)}</MathText></span>
        <StatusChip status={status} />
        <ChevronDown size={18} aria-hidden="true" className="ws-chevron" />
      </button>
    </section>
  }

  const action = mode === 'local' ? null : primaryAction({ mode, review, submitted, checking, saveState })
  const actionDisabled = !action || action.blocked || !ready || !hasWork || pendingPhotos > 0
    || saveState === 'uploading' || (mode === 'check' && tutorBusy)
  const statusText = saveState === 'error' ? saveMessage
    : saveState === 'saving' ? saveMessage || 'Saving…' : saveMessage || (saveState === 'saved' ? 'Saved' : '')

  return <section className="ws-part is-active" aria-label={`Part ${part.label}, current part`} onFocusCapture={onActivate}>
    <div className="ws-part-head">
      <span className="ws-part-pill">{part.label}</span>
      <span className="ws-part-marks">{marksLabel(part.marks)}</span>
    </div>
    {prompt.length > 0 && <div className="question-part-prompt">{prompt.map((block, index) => <QuestionBlock block={block} key={index} />)}</div>}

    <div className="ws-working">
      <div className="ws-working-head">
        <label htmlFor={`${part.id}-answer`}>Your working</label>
        {!hasUploadError && statusText && <span className={`ws-save-status${saveState === 'error' ? ' is-error' : ''}`} role={saveState === 'error' ? 'alert' : 'status'}>
          {saveState === 'saved' && <Check size={14} strokeWidth={2.4} aria-hidden="true" />}{statusText}
        </span>}
      </div>
      <WorkingEditor part={part} value={answer} ready={ready} onChange={onAnswerChange}
        uploadsEnabled={uploadsEnabled} pageCount={attachments.length + pendingPhotos} uploading={saveState === 'uploading'} onPickPhotos={onUpload} />
    </div>

    <SolutionUploadQueue items={uploadQueue} busy={uploadBusy} blocked={uploadBlocked} onRetry={onRetryUpload} onRemove={onDiscardUpload} />
    <SavedPages attachments={attachments} ready={ready} onRemove={onRemoveAttachment} />

    {mode === 'submit' && aiMarkable === false && <p className="ws-note">AI checking is not available for graph or diagram answers yet. Submit your work, then compare it with the mark scheme.</p>}
    {mode === 'check' && <ResultStrip key={review?.id || 'none'} review={review}checking={checking} error={checkError} assisted={assisted} onNext={onNext} nextLabel={nextLabel} />}

    <div className="ws-part-foot">
      <div className="ws-part-links">
        <button type="button" className="ws-link-button" aria-expanded={panel === 'scheme'} aria-controls={`${part.id}-scheme`} onClick={() => togglePanel('scheme')}>{panel === 'scheme' ? 'Hide mark scheme' : 'Show mark scheme'}</button>
        {showHistory && <button type="button" className="ws-link-button" aria-expanded={panel === 'history'} onClick={() => togglePanel('history')}>{panel === 'history' ? 'Hide earlier attempts' : 'Earlier attempts'}</button>}
      </div>
      {action && <div className="ws-primary">
        {action.hint && <span className="ws-primary-hint">{action.hint}</span>}
        <button type="button" className="ws-primary-button" disabled={actionDisabled} onClick={mode === 'check' ? onCheck : onSubmit}>
          {action.busy ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <Check size={18} strokeWidth={2.4} aria-hidden="true" />}
          {action.label}
        </button>
      </div>}
    </div>
    {panel === 'scheme' && <MarkScheme partId={part.id} />}
    {panel === 'history' && <EarlierAttempts partId={part.id} submitted={submitted} />}
  </section>
}
