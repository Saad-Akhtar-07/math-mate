import {
  BookOpenCheck,
  Bot,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Eye,
  EyeOff,
  Lightbulb,
  LoaderCircle,
  Save,
  Send,
  Sparkles,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import InlineContent from '../components/notes/InlineContent.jsx'
import ContentBlockRenderer from '../components/question-renderer/ContentBlockRenderer.jsx'
import ReaderShell from '../components/ReaderShell.jsx'
import SolutionImage from '../components/SolutionImage.jsx'
import SolutionUploadQueue from '../components/SolutionUploadQueue.jsx'
import { getQuestionBank, getQuestionPartSolution } from '../api/content.js'
import {
  getStudentResponses,
  getStudentResponse,
  getTutorChatTurns,
  getTutorReviews,
  removeSolutionImage,
  requestTutorReview,
  saveStudentResponse,
  submitStudentResponse,
  getResponseSubmissions,
  sendTutorChatMessage,
  uploadSolutionImage,
} from '../api/submissions.js'
import { syllabus } from '../data/syllabus.js'
import { readDrafts, saveDraft, removeDraft } from '../data/localDrafts.js'
import NotFound from './NotFound.jsx'
import useVoiceInput from '../hooks/useVoiceInput.js'
import useTutorSpeech from '../hooks/useTutorSpeech.js'
import useSolutionUploads from '../hooks/useSolutionUploads.js'
import { VoiceInput, VoicePreferences, VoiceStatus, ReadAloud } from '../components/TutorVoice.jsx'
import './PracticeWorkspace.css'

const mathsTools = [
  { id: 'power', label: 'x²', name: 'Add a power' },
  { id: 'root', label: '√', name: 'Add a square root' },
  { id: 'fraction', label: 'a/b', name: 'Add a fraction' },
  { id: 'multiply', label: '×', name: 'Add a multiplication sign' },
  { id: 'divide', label: '÷', name: 'Add a division sign' },
  { id: 'probability', label: 'P( )', name: 'Add probability notation' },
]

const TUTOR_WIDTH_STORAGE_KEY = 'ai-tutor-panel-width-v1'
const DEFAULT_TUTOR_WIDTH = 420
const MIN_TUTOR_WIDTH = 310
const MAX_TUTOR_WIDTH = 650
const MIN_QUESTION_WIDTH = 420
const RESIZER_WIDTH = 22

function storedTutorWidth() {
  try {
    const value = Number(localStorage.getItem(TUTOR_WIDTH_STORAGE_KEY))
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_TUTOR_WIDTH
  } catch {
    return DEFAULT_TUTOR_WIDTH
  }
}

function tutorWidthBounds(workspace) {
  const availableWidth = workspace?.getBoundingClientRect().width || 1080
  return {
    minimum: MIN_TUTOR_WIDTH,
    maximum: Math.max(
      MIN_TUTOR_WIDTH,
      Math.min(MAX_TUTOR_WIDTH, availableWidth - MIN_QUESTION_WIDTH - RESIZER_WIDTH),
    ),
  }
}

function clampTutorWidth(workspace, requestedWidth) {
  const { minimum, maximum } = tutorWidthBounds(workspace)
  return Math.round(Math.min(maximum, Math.max(minimum, requestedWidth)))
}

function QuestionTable({ rows }) {
  return <div className="question-table-wrap"><table className="question-table"><tbody>{rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} className={ci === 0 ? 'question-table-label' : ''}><InlineContent content={cell || '\u00a0'} /></td>)}</tr>)}</tbody></table></div>
}

function CardsDiagram({ sets }) {
  return <div className="cards-diagram" aria-label="Card sets">{sets.map((set) => <div className="card-set" key={set.label}><strong>{set.label}</strong><div>{set.values.map((value, index) => <span key={`${value}-${index}`}>{value}</span>)}</div></div>)}</div>
}

function BagsDiagram({ bags }) {
  return <div className="bags-diagram" aria-label="Contents of the bags">{bags.map((bag) => <div className="bag-card" key={bag.label}><div className="bag-shape" aria-hidden="true">{Array.from({ length: bag.black }, (_, i) => <span className="ball black" key={`b-${i}`} />)}{Array.from({ length: bag.white }, (_, i) => <span className="ball white" key={`w-${i}`} />)}</div><strong>{bag.label}</strong><small>{bag.black} black, {bag.white} white</small></div>)}</div>
}

const regionClass = { m_only: 'venn-m-only', p_only: 'venn-p-only', d_only: 'venn-p-only', c_only: 'venn-c-only', g_only: 'venn-c-only', m_p: 'venn-mp', m_d: 'venn-mp', m_c: 'venn-mc', m_g: 'venn-mc', p_c: 'venn-pc', d_g: 'venn-pc', m_p_c: 'venn-all', m_d_g: 'venn-all', outside: 'venn-outside' }

function VennDiagram({ labels, regions }) {
  return <div className="venn-frame" role="img" aria-label={`Venn diagram for sets ${labels.join(', ')}`}><div className="venn-circle venn-left" /><div className="venn-circle venn-right" /><div className="venn-circle venn-bottom" /><span className="venn-label venn-label-left">{labels[0]}</span><span className="venn-label venn-label-right">{labels[1]}</span><span className="venn-label venn-label-bottom">{labels[2]}</span>{Object.entries(regions).map(([key, value]) => value !== null && <span className={`venn-value ${regionClass[key]}`} key={key}>{value}</span>)}</div>
}

function CoordinateGrid({ x_label: xLabel, y_label: yLabel, x_min: xMin, x_max: xMax, y_min: yMin, y_max: yMax }) {
  return <div className="coordinate-figure" role="img" aria-label={`Blank graph from ${xMin} to ${xMax} and ${yMin} to ${yMax}`}><span className="axis-label axis-y">{yLabel}</span><div className="coordinate-grid"><span>{yMax}</span><span>{yMin}</span></div><div className="axis-ticks"><span>{xMin}</span><span>{xMax}</span></div><span className="axis-label axis-x">{xLabel}</span></div>
}

function QuestionBlock({ block }) {
  if (block.type === 'cards') return <CardsDiagram sets={block.sets} />
  if (block.type === 'bags') return <BagsDiagram bags={block.bags} />
  if (block.type === 'venn') return <VennDiagram labels={block.labels} regions={block.regions} />
  return <ContentBlockRenderer block={block} />
}

function AnswerComposer({ part, value, attachments, saveState, saveMessage, onChange, onSave, onSubmit, submitted, ready = true, uploadsEnabled = false, onUpload, onRemoveAttachment, localDraftOnly = false, uploadQueue = [], uploadBusy, uploadBlocked, onRetryUpload, onDiscardUpload }) {
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const pendingPhotos = uploadQueue.filter((item) => item.status !== 'saved').length
  const hasUploadError = uploadQueue.some((item) => item.status === 'failed' && item.error === saveMessage)

  const insertMaths = (tool) => {
    if (!ready) return
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? value.length
    const end = textarea?.selectionEnd ?? value.length
    const selected = value.slice(start, end)
    let insertion = ''
    let cursorOffset = 0

    if (tool.id === 'power') {
      insertion = selected ? `${selected}^2` : '^2'
      cursorOffset = insertion.length
    } else if (tool.id === 'root') {
      insertion = `sqrt(${selected})`
      cursorOffset = selected ? insertion.length : 5
    } else if (tool.id === 'fraction') {
      insertion = selected ? `(${selected})/()` : '()/()'
      cursorOffset = selected ? insertion.length - 1 : 1
    } else if (tool.id === 'probability') {
      insertion = `P(${selected})`
      cursorOffset = selected ? insertion.length : 2
    } else {
      insertion = tool.id === 'multiply' ? ' × ' : ' ÷ '
      cursorOffset = insertion.length
    }

    const nextValue = `${value.slice(0, start)}${insertion}${value.slice(end)}`
    onChange(nextValue)
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + cursorOffset, start + cursorOffset)
    })
  }

  return <div className="answer-composer">
    <div className="answer-composer-heading">
      <label htmlFor={`${part.id}-answer`}>Your working and answer</label>
      <span>{value.trim() ? 'Draft added' : 'Show your method'}</span>
    </div>
    <div className="answer-entry">
      <textarea ref={textareaRef} id={`${part.id}-answer`} rows="4" maxLength="20000" spellCheck="false" disabled={!ready} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Write each step here…" />
      {part.answer_suffix && <span className="answer-suffix">{part.answer_suffix}</span>}
    </div>
    <div className="maths-toolbar" aria-label="Maths input tools">
      <span>Maths tools</span>
      <div>{mathsTools.map((tool) => <button type="button" key={tool.id} disabled={!ready} title={tool.name} aria-label={tool.name} onClick={() => insertMaths(tool)}>{tool.label}</button>)}</div>
      <small>Keyboard: / for fractions · ^ for powers</small>
    </div>
    <div className="solution-input-footer">
      <div className="solution-input-actions">
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          aria-label="Upload solution pages"
          disabled={!ready || !uploadsEnabled || attachments.length + pendingPhotos >= 4}
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files || [])
            if (files.length) onUpload(files)
            event.target.value = ''
          }}
        />
        <button type="button" className="attach-solution-button" onClick={() => fileInputRef.current?.click()} disabled={!ready || !uploadsEnabled || localDraftOnly || attachments.length + pendingPhotos >= 4 || saveState === 'uploading'} title={!uploadsEnabled || localDraftOnly ? 'Photo uploads are coming later' : 'JPEG, PNG or WebP. Up to 4 pages, 10 MB per original.'}>
          {saveState === 'uploading' ? <LoaderCircle className="spin" size={16} /> : <Camera size={16} />}
          Add solution photo
        </button>
        <button type="button" className="save-solution-button" onClick={onSave} disabled={!ready || saveState === 'saving' || saveState === 'submitting' || saveState === 'uploading'}>
          {saveState === 'saving' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
          Save work
        </button>
        {!localDraftOnly && onSubmit && <button type="button" className="save-solution-button" onClick={onSubmit} disabled={!ready || pendingPhotos > 0 || (!value.trim() && !attachments.length) || submitted || saveState === 'submitting'}>
          {saveState === 'submitting' ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
          {submitted ? 'Submitted' : 'Submit answer'}
        </button>}
      </div>
      {!hasUploadError && <span className={`solution-save-status ${saveState === 'error' ? 'is-error' : ''}`} role={saveState === 'error' ? 'alert' : 'status'}>
        {saveMessage || (saveState === 'saved' ? (localDraftOnly ? 'Saved on this device' : 'Saved securely') : saveState === 'saving' ? 'Saving…' : 'Text auto-saves after you pause')}
      </span>}
    </div>
    {uploadsEnabled && <p className="solution-page-limit">{attachments.length} / 4 pages</p>}
    <SolutionUploadQueue items={uploadQueue} busy={uploadBusy} blocked={uploadBlocked} onRetry={onRetryUpload} onRemove={onDiscardUpload} />
    {attachments.length > 0 && <div className="solution-attachments" aria-label="Attached solution images">
      {attachments.map((attachment) => <figure key={attachment.id}>
        <SolutionImage fileId={attachment.file_id} filename={attachment.original_filename} pageNumber={attachment.position} />
        <figcaption><span title={attachment.original_filename}>Page {attachment.position}</span><button type="button" disabled={!ready} aria-label={`Remove ${attachment.original_filename}`} onClick={() => onRemoveAttachment(attachment.id)}><Trash2 size={14} /></button></figcaption>
      </figure>)}
    </div>}
  </div>
}

function SubmissionHistory({ partId, submitted }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    getResponseSubmissions(partId).then((data) => {
      if (!cancelled) { setItems(data.submissions); setCursor(data.next_cursor) }
    }).catch((failure) => { if (!cancelled) setError(failure.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, partId, submitted])
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
  return <div className="submission-history">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide submitted answers' : 'View submitted answers'}</button>
    {open && <div>{error && <p role="alert">{error}</p>}{loading && <p role="status">Loading submitted answers…</p>}
      {!loading && !items.length && !error && <p>No submitted answers yet.</p>}
      {items.map((item) => <article key={item.id}><small>Submitted {new Date(item.submitted_at).toLocaleString()}</small>{item.typed_work && <pre>{item.typed_work}</pre>}
        {!!item.attachments?.length && <div className="solution-attachments" aria-label="Submitted solution pages">{item.attachments.map((page) => <figure key={page.file_id}><SolutionImage fileId={page.file_id} filename={page.original_filename} pageNumber={page.position} /><figcaption>Page {page.position}</figcaption></figure>)}</div>}
      </article>)}
      {cursor && <button type="button" disabled={loading} onClick={loadMore}>Load earlier answers</button>}
    </div>}
  </div>
}

function QuestionPart({ part, answer, attachments, saveState, saveMessage, tutorBusy, tutorError, isActive, onAnswerChange, onSave, onSubmit, submitted, ready, aiEnabled = true, uploadsEnabled, onUpload, onRemoveAttachment, onActivate, onTutorRequest, localDraftOnly = false, uploadQueue, uploadBusy, uploadBlocked, onRetryUpload, onDiscardUpload }) {
  const [showScheme, setShowScheme] = useState(false)
  const [scheme, setScheme] = useState(null)
  const [schemeState, setSchemeState] = useState('idle')
  const schemeId = `${part.id}-scheme`

  const toggleScheme = async () => {
    if (showScheme) {
      setShowScheme(false)
      return
    }
    setShowScheme(true)
    if (scheme) return
    setSchemeState('loading')
    try {
      setScheme(await getQuestionPartSolution(part.id))
      setSchemeState('loaded')
    } catch {
      setSchemeState('error')
    }
  }

  return <section className={`question-part ${isActive ? 'is-active' : ''}`} onFocusCapture={onActivate}>
    <div className="question-part-heading"><span>{part.label}</span><strong>{part.marks} {part.marks === 1 ? 'mark' : 'marks'}</strong></div>
    <div className="question-part-prompt">{part.prompt.map((block, index) => <QuestionBlock block={block} key={index} />)}</div>
    <AnswerComposer part={part} value={answer} attachments={attachments} saveState={saveState} saveMessage={saveMessage} onChange={onAnswerChange} onSave={onSave} onSubmit={onSubmit} submitted={submitted} ready={ready} uploadsEnabled={uploadsEnabled} onUpload={onUpload} onRemoveAttachment={onRemoveAttachment} localDraftOnly={localDraftOnly} uploadQueue={uploadQueue} uploadBusy={uploadBusy} uploadBlocked={uploadBlocked} onRetryUpload={onRetryUpload} onDiscardUpload={onDiscardUpload} />
    {!localDraftOnly && onSubmit && <SubmissionHistory partId={part.id} submitted={submitted} />}
    <div className="question-help-row">
      <div className="tutor-actions">
        <button type="button" className="hint-button" disabled={!aiEnabled || localDraftOnly || tutorBusy} onClick={() => onTutorRequest('hint', part, answer)}><Lightbulb size={17} /> Give me a hint</button>
        <button type="button" className="check-ai-button" disabled={!aiEnabled || localDraftOnly || tutorBusy || saveState === 'uploading'} onClick={() => onTutorRequest('check', part, answer)}><Sparkles size={17} /> Check with AI</button>
      </div>
      <button type="button" className={`mark-scheme-toggle ${showScheme ? 'is-open' : ''}`} aria-expanded={showScheme} aria-controls={schemeId} onClick={toggleScheme}>{showScheme ? <EyeOff size={17} /> : <Eye size={17} />}{showScheme ? 'Hide mark scheme' : 'Mark scheme'}</button>
    </div>
    {tutorError && <p className="response-load-warning" role="alert">{tutorError}</p>}
    {showScheme && <div className="mark-scheme-panel" id={schemeId}>
      {schemeState === 'loading' && <p>Loading mark scheme…</p>}
      {schemeState === 'error' && <p role="alert">The mark scheme could not be loaded.</p>}
      {scheme && <><div className="scheme-answer"><span>Answer</span><p><InlineContent content={scheme.answer} /></p></div>{scheme.marking_points.length > 0 && <div className="scheme-points"><span>How marks are awarded</span><ol>{scheme.marking_points.map((point, index) => <li key={`${point.code}-${index}`}><strong>{point.code}</strong><p><InlineContent content={point.text} /></p></li>)}</ol></div>}</>}
    </div>}
  </section>
}

const teachingMoveLabels = {
  ask_question: 'Think it through',
  small_hint: 'Small hint',
  formula_reminder: 'Formula reminder',
  worked_step: 'One worked step',
  similar_example: 'Similar example',
  explain_concept: 'Concept explanation',
  check_understanding: 'Check your thinking',
  encourage: 'Tutor',
  redirect: 'Back to the question',
}

function TutorWaitMessage() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 10000)
    return () => clearTimeout(timer)
  }, [])
  return <p className="tutor-availability-note" role="status">{slow
    ? 'This is taking longer than usual. You can continue writing while the tutor finishes.'
    : 'Your request is in progress. You can continue writing.'}</p>
}

function AiTutorPanel({ topic, question, displayNumber, activePart, reviews, reviewState, chatTurns, chatState, onRequest, onSendMessage, onRetryMessage }) {
  const [chatInput, setChatInput] = useState('')
  const [showVoiceSettings, setShowVoiceSettings] = useState(false)
  const settingsRef = useRef(null)
  const settingsButtonRef = useRef(null)
  const speech = useTutorSpeech(activePart.id)
  const voiceInput = useVoiceInput(activePart.id, speech.stop)
  const awaitingVoice = useRef(new Set())
  const messageEndRef = useRef(null)
  const isEmpty = Boolean(question.isPlaceholder || question.localDraftOnly || question.capabilities?.aiTutor === false)
  const partReviews = reviews.filter((review) => review.question_part_id === activePart.id)
  const partTurns = chatTurns.filter((turn) => turn.question_part_id === activePart.id)
  const isReviewing = reviewState === 'reviewing' || partReviews.some((review) => ['pending', 'processing'].includes(review.status))
  const isChatting = chatState === 'sending' || partTurns.some((turn) => ['pending', 'processing'].includes(turn.status))
  const isBusy = isReviewing || isChatting
  const timeline = [
    ...partReviews.map((review) => ({ kind: 'review', createdAt: review.created_at, value: review })),
    ...partTurns.map((turn) => ({ kind: 'chat', createdAt: turn.created_at, value: turn })),
  ].sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))

  useEffect(() => {
    if (!showVoiceSettings) return undefined
    const dismiss = event => {
      if (event.type === 'keydown') {
        if (event.key !== 'Escape') return
        settingsButtonRef.current?.focus()
      } else if (settingsRef.current?.contains(event.target) || settingsButtonRef.current?.contains(event.target)) return
      setShowVoiceSettings(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismiss)
    }
  }, [showVoiceSettings])

  useEffect(() => {
    setChatInput('')
    awaitingVoice.current.clear()
  }, [activePart.id])

  useEffect(() => {
    for (const item of timeline) {
      const key = `${item.kind}:${item.value.client_message_id || item.value.id}`
      if (['pending', 'processing'].includes(item.value.status)) awaitingVoice.current.add(key)
      else if (awaitingVoice.current.delete(key) && item.value.status === 'completed' && speech.autoRead && voiceInput.state === 'idle') {
        speech.play(item.kind, item.value.id)
      }
    }
  }, [chatTurns, reviews, speech.autoRead, voiceInput.state])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [partReviews.length, partTurns.length, isBusy])

  const submitMessage = (event) => {
    event.preventDefault()
    const message = chatInput.trim()
    if (!message || isBusy || isEmpty) return
    voiceInput.cancel()
    speech.stop()
    setChatInput('')
    onSendMessage(activePart, message)
  }

  const handleComposerKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return <aside className="ai-tutor-panel" id="ai-tutor-panel" aria-label="AI tutor">
    <header className="ai-tutor-header">
      <div className="ai-tutor-avatar"><Bot size={21} /></div>
      <div><div className="ai-tutor-title"><h2>AI Tutor</h2></div><p><i /> {question.localDraftOnly ? 'Available in a later phase' : isReviewing ? 'Reviewing your work' : isChatting ? 'Thinking with you' : 'Ready to help'}</p></div>
      <div className="tutor-header-actions">
        <button ref={settingsButtonRef} type="button" className="workspace-icon-button" aria-label="Voice settings" title="Voice settings" aria-expanded={showVoiceSettings} aria-controls="tutor-voice-settings" onClick={() => setShowVoiceSettings(value => !value)}><SlidersHorizontal size={17} /></button>
      </div>
    </header>
    {showVoiceSettings && <section ref={settingsRef} className="tutor-settings-popover" id="tutor-voice-settings" aria-label="Voice settings">
      <div className="tutor-settings-heading"><strong>Voice settings</strong><button type="button" className="workspace-icon-button" aria-label="Close voice settings" onClick={() => { setShowVoiceSettings(false); settingsButtonRef.current?.focus() }}><X size={16} /></button></div>
      <VoicePreferences speech={speech} />
    </section>}
    <div className="ai-tutor-context"><strong>{question.isPlaceholder ? topic.title : `Question ${displayNumber} ${activePart.label}`}</strong><p>{question.localDraftOnly ? 'AI support coming later' : question.isPlaceholder ? 'Questions coming soon' : `${activePart.marks} ${activePart.marks === 1 ? 'mark' : 'marks'}`}</p></div>
    <div className="ai-tutor-conversation" aria-live="polite" aria-busy={isBusy}>
      {timeline.length === 0 && !isBusy ? <div className="tutor-welcome">
        <div><Sparkles size={22} /></div>
        <h3>{question.localDraftOnly ? 'Your AI tutor space is ready.' : isEmpty ? `Your ${topic.title} tutor is ready.` : 'Try it—I’m here if you get stuck.'}</h3>
        <p>{question.localDraftOnly ? 'You can explore every question and save written work on this device. AI hints and feedback are coming in a later phase.' : isEmpty ? 'When a reviewed question is loaded, I will follow its active part and help without taking over the solution.' : 'Ask for a formula reminder, a hint, or a short explanation. If you are still stuck, we can work through a similar example.'}</p>
      </div> : <div className="tutor-messages">
        {timeline.map((item) => item.kind === 'review' ? <div className="tutor-message assistant" key={`review-${item.value.id}`}>
          <span>{item.value.status === 'completed' ? `Attempt ${item.value.attempt_number} · ${item.value.marks_awarded}/${item.value.marks_maximum} marks` : `Attempt ${item.value.attempt_number}`}</span>
          <p>{item.value.feedback || item.value.error_message || (['pending', 'processing'].includes(item.value.status) ? 'Your saved work is being reviewed.' : 'This review did not complete.')}</p>
          {item.value.status === 'completed' && <ReadAloud speech={speech} type="review" id={item.value.id} disabled={voiceInput.state !== 'idle'} />}
        </div> : <div className="tutor-chat-turn" key={`chat-${item.value.client_message_id}`}>
          <div className="tutor-message student"><span>You</span><p>{item.value.learner_message}</p></div>
          {item.value.status === 'completed' && <div className="tutor-message assistant"><span>{teachingMoveLabels[item.value.teaching_move] || 'Tutor'}</span><p>{item.value.tutor_message}</p><ReadAloud speech={speech} type="chat" id={item.value.id} disabled={voiceInput.state !== 'idle'} /></div>}
          {['pending', 'processing'].includes(item.value.status) && <div className="tutor-message assistant"><span>Thinking</span><p className="tutor-thinking"><LoaderCircle className="spin" size={15} /> Preparing useful guidance…</p></div>}
          {item.value.status === 'failed' && <div className="tutor-message assistant is-error" role="alert"><span>Message saved</span><p>{item.value.error_message || 'I could not answer just now.'}</p><button type="button" className="tutor-retry-button" disabled={isBusy} onClick={() => onRetryMessage(activePart, item.value)}>Retry</button></div>}
        </div>)}
        {isReviewing && <div className="tutor-message assistant"><span>Reviewing</span><p className="tutor-thinking"><LoaderCircle className="spin" size={16} /> Reading your method and preparing the next hint…</p></div>}
        <VoiceStatus speech={speech} />
        <div ref={messageEndRef} />
      </div>}
    </div>
    {isBusy && <TutorWaitMessage />}
    {timeline.some((item) => item.value.status === 'failed') && <p className="tutor-availability-note">The tutor is unavailable right now. Your saved work will be here when you return.</p>}
    <div className="tutor-composer">
    <div className="tutor-quick-actions" aria-label="Tutor shortcuts">
      <button type="button" disabled={isEmpty || isBusy} onClick={() => onRequest('hint', activePart)}><Lightbulb size={15} /> Hint</button>
      <button type="button" disabled={isEmpty || isBusy} onClick={() => onSendMessage(activePart, 'Please explain the main concept behind this question briefly, without solving it for me.')}><BookOpenCheck size={15} /> Explain</button>
      <button type="button" disabled={isEmpty || isBusy} onClick={() => onRequest('check', activePart)}><CheckCircle2 size={15} /> Check work</button>
    </div>
    <VoiceInput input={voiceInput} disabled={isEmpty || isBusy} onUseDraft={(text) => {
      const combined = [chatInput.trim(), text.trim()].filter(Boolean).join('\n')
      if (combined.length > 1000) {
        voiceInput.setDraft({ ...voiceInput.draft, warning: 'The combined message is over 1,000 characters. Shorten the transcript or existing message first.' })
        return
      }
      setChatInput(combined)
      voiceInput.cancel()
    }} />
    <form className="tutor-chat-form" onSubmit={submitMessage}>
      <label className="sr-only" htmlFor={`tutor-message-${activePart.id}`}>Ask the AI tutor about this question</label>
      <textarea
        id={`tutor-message-${activePart.id}`}
        rows="2"
        maxLength="1000"
        value={chatInput}
        onChange={(event) => setChatInput(event.target.value)}
        onKeyDown={handleComposerKeyDown}
        placeholder={question.localDraftOnly ? 'AI tutor coming later' : isEmpty ? 'Available with a question' : 'Ask about this step…'}
        disabled={isEmpty || isBusy}
      />
      <button type="submit" aria-label="Send message" title="Send message" disabled={isEmpty || isBusy || !chatInput.trim()}><Send size={18} /></button>
      <small>Enter to send · Shift+Enter for a new line</small>
    </form>
    </div>
  </aside>
}

function createEmptyQuestion(topic) {
  return {
    id: `topic-${topic.number || 'unknown'}-empty`,
    isPlaceholder: true,
    number: '—',
    title: `${topic.title || 'Topic'} practice`,
    syllabus_codes: [],
    total_marks: 0,
    prompt: [],
    parts: [{
      id: `topic-${topic.number || 'unknown'}-empty-part`,
      label: '',
      marks: 0,
      prompt: [],
    }],
  }
}

function EmptyQuestionCard({ topic, loading = false, error = '' }) {
  const title = loading
    ? 'Loading practice questions…'
    : error
      ? 'Questions could not be loaded.'
      : `Questions for ${topic.title} are coming later.`
  const description = loading
    ? 'Preparing the question bank.'
    : error
      ? 'Please refresh and try again.'
      : 'Questions for this topic will appear here when they are added.'
  return <article className="exam-question empty-question-card">
    <header className="exam-question-header">
      <div className="question-number empty"><CircleDashed size={22} /></div>
      <div><p>QUESTION WORKSPACE</p><h2>{topic.title} practice</h2></div>
      <strong>Awaiting questions</strong>
    </header>
    <div className="empty-question-body">
      <div className="empty-question-icon"><BookOpenCheck size={25} /></div>
      <p className="empty-question-kicker">{loading ? 'Connecting to content library' : error ? 'Connection needed' : 'Practice set coming next'}</p>
      <h3>{title}</h3>
      <p>{description}</p>
      <div className="empty-question-preview" aria-hidden="true">
        <span />
        <span />
        <span />
        <div />
      </div>
    </div>
  </article>
}

export default function QuestionPracticePage() {
  const { topicNumber } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const topic = syllabus.find((item) => item.number === topicNumber)
  const [questionBank, setQuestionBank] = useState(null)
  const [isLoading, setIsLoading] = useState(Boolean(topic))
  const [loadError, setLoadError] = useState('')
  const questions = questionBank?.questions || []
  const hasQuestions = questions.length > 0
  const usesLocalDrafts = questions.some((item) => item.localDraftOnly)
  const aiEnabled = questions.some((item) => !item.localDraftOnly && item.capabilities?.aiTutor !== false)
  const subtopicFilter = searchParams.get('subtopic') || 'all'
  const paperFilter = searchParams.get('paper') || 'all'
  const searchQuery = searchParams.get('q') || ''
  const visibleQuestions = questions.filter((item) => {
    if (subtopicFilter !== 'all' && !item.subtopicCodes?.includes(subtopicFilter)) return false
    if (paperFilter === 'calculator' && !item.paper?.calculatorAllowed) return false
    if (paperFilter === 'non-calculator' && item.paper?.calculatorAllowed) return false
    if (searchQuery && !`${item.title} ${item.paper?.year || ''} ${item.paper?.component || ''} ${item.number}`.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })
  const requestedQuestionId = searchParams.get('question')
  const selectedIndex = Math.max(0, visibleQuestions.findIndex((item) => item.id === requestedQuestionId))
  const navigationStart = Math.floor(selectedIndex / 4) * 4
  const navigationQuestions = visibleQuestions.slice(navigationStart, navigationStart + 4)
  const emptyQuestion = createEmptyQuestion(topic || {})
  const [answers, setAnswers] = useState({})
  const [attachments, setAttachments] = useState({})
  const [saveStates, setSaveStates] = useState({})
  const [saveMessages, setSaveMessages] = useState({})
  const [responseLoadError, setResponseLoadError] = useState('')
  const [responsesReady, setResponsesReady] = useState(false)
  const [submittedParts, setSubmittedParts] = useState({})
  const [pageMutations, setPageMutations] = useState({})
  const [conflicts, setConflicts] = useState({})
  const [activePartId, setActivePartId] = useState('')
  const [reviews, setReviews] = useState([])
  const [reviewStates, setReviewStates] = useState({})
  const [reviewErrors, setReviewErrors] = useState({})
  const [chatTurns, setChatTurns] = useState([])
  const [chatStates, setChatStates] = useState({})
  const [tutorPanelWidth, setTutorPanelWidth] = useState(storedTutorWidth)
  const [tutorPanelMaxWidth, setTutorPanelMaxWidth] = useState(MAX_TUTOR_WIDTH)
  const [isResizingTutor, setIsResizingTutor] = useState(false)
  const answersRef = useRef({})
  const revisionsRef = useRef(new Map())
  const conflictsRef = useRef(new Set())
  const restoreFailedRef = useRef(false)
  const saveTimersRef = useRef(new Map())
  const saveVersionsRef = useRef(new Map())
  const saveQueuesRef = useRef(new Map())
  const busyPartsRef = useRef(new Set())
  const workspaceRef = useRef(null)
  const tutorPanelWidthRef = useRef(tutorPanelWidth)
  const preferredTutorPanelWidthRef = useRef(tutorPanelWidth)
  const resizeFrameRef = useRef(null)
  const pendingPointerXRef = useRef(null)
  const isResizingTutorRef = useRef(false)
  const question = hasQuestions ? (visibleQuestions[selectedIndex] || visibleQuestions[0] || emptyQuestion) : emptyQuestion
  const activePart = question.parts.find((part) => part.id === activePartId) || question.parts[0]

  const photoUploads = useSolutionUploads({
    scope: topicNumber,
    attachments,
    canStart: (partId) => responsesReady && !restoreFailedRef.current && !busyPartsRef.current.has(partId) && !conflictsRef.current.has(partId),
    onBusy: (partId, busy) => {
      if (busy) busyPartsRef.current.add(partId)
      else busyPartsRef.current.delete(partId)
      setPageMutations((current) => ({ ...current, [partId]: busy }))
    },
    prepare: async (partId) => {
      clearTimeout(saveTimersRef.current.get(partId))
      saveTimersRef.current.delete(partId)
      await persistAnswer(partId, answersRef.current[partId] || '')
      setSaveStates((current) => ({ ...current, [partId]: 'uploading' }))
      setSaveMessages((current) => ({ ...current, [partId]: 'Saving photos…' }))
    },
    send: (partId, file, options) => applyPageMutation(partId,
      (revision) => uploadSolutionImage(partId, file, revision, options), options.signal),
    read: (partId, options) => applyPageMutation(partId,
      () => getStudentResponse(partId, options), options.signal),
    onError: (partId, error) => pageMutationError(partId, error),
    onComplete: (partId, response) => {
      setSaveStates((current) => ({ ...current, [partId]: 'saved' }))
      setSaveMessages((current) => ({ ...current, [partId]: `${response.attachments.length} solution page${response.attachments.length === 1 ? '' : 's'} saved` }))
    },
  })

  useEffect(() => {
    let cancelled = false
    if (!topic) return undefined
    setIsLoading(true)
    setLoadError('')
    setQuestionBank(null)
    getQuestionBank(topic.number)
      .then((bank) => {
        if (!cancelled) setQuestionBank(bank)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [topic])

  useEffect(() => {
    setAnswers({})
    answersRef.current = {}
    setAttachments({})
    setSaveStates({})
    setSaveMessages({})
    setResponseLoadError('')
    setResponsesReady(false)
    setSubmittedParts({})
    setPageMutations({})
    setConflicts({})
    revisionsRef.current.clear()
    conflictsRef.current.clear()
    restoreFailedRef.current = false
    setActivePartId('')
    setReviews([])
    setReviewStates({})
    setReviewErrors({})
    setChatTurns([])
    setChatStates({})
    saveTimersRef.current.forEach((timer) => clearTimeout(timer))
    saveTimersRef.current.clear()
    if (!topic) return undefined
    let cancelled = false
    if (!questionBank?.questions?.length) return undefined
    const storedContent = usesLocalDrafts
      ? Promise.resolve([Object.entries(readDrafts(topic.number)).map(([id, typed_work]) => ({ question_part_id: id, typed_work, attachments: [] })), [], []])
      : Promise.all([getStudentResponses(topic.number), aiEnabled ? getTutorReviews(topic.number) : [], aiEnabled ? getTutorChatTurns(topic.number) : []])
    storedContent
      .then(([responses, restoredReviews, restoredChatTurns]) => {
        if (cancelled) return
        const restoredAnswers = {}
        const restoredAttachments = {}
        const restoredStates = {}
        const restoredSubmitted = {}
        const restoredConflicts = {}
        const local = readDrafts(topic.number)
        responses.forEach((response) => {
          restoredAnswers[response.question_part_id] = response.typed_work
          restoredAttachments[response.question_part_id] = response.attachments
          restoredStates[response.question_part_id] = 'saved'
          revisionsRef.current.set(response.question_part_id, response.revision)
          restoredSubmitted[response.question_part_id] = Boolean(response.submitted)
          if (!usesLocalDrafts && Object.hasOwn(local, response.question_part_id) && local[response.question_part_id] !== response.typed_work) {
            conflictsRef.current.add(response.question_part_id)
            restoredConflicts[response.question_part_id] = response
            restoredSubmitted[response.question_part_id] = false
          }
        })
        answersRef.current = { ...restoredAnswers, ...local, ...answersRef.current }
        setAnswers(answersRef.current)
        setAttachments(restoredAttachments)
        setSaveStates((current) => ({ ...restoredStates, ...current }))
        setSubmittedParts(restoredSubmitted)
        setConflicts(restoredConflicts)
        setResponsesReady(true)
        // Recover older device-only drafts; existing server answers require an
        // explicit choice above when they differ from the local recovery copy.
        if (!usesLocalDrafts) {
          const validParts = new Set(questionBank.questions.flatMap((item) => item.parts.map((part) => part.id)))
          for (const [id, value] of Object.entries(local)) {
            if (validParts.has(id) && !restoredConflicts[id]) {
              persistAnswer(id, value).catch(() => {})
            }
          }
        }
        setReviews(restoredReviews)
        setChatTurns(restoredChatTurns)
      })
      .catch((error) => {
        if (!cancelled) {
          restoreFailedRef.current = true
          setResponseLoadError(error.message)
        }
      })
    return () => {
      cancelled = true
      saveTimersRef.current.forEach((timer) => clearTimeout(timer))
      saveTimersRef.current.clear()
    }
  }, [topicNumber, questionBank, usesLocalDrafts, aiEnabled])

  const hasPendingTutorWork = reviews.some((item) => ['pending', 'processing'].includes(item.status))
    || chatTurns.some((item) => ['pending', 'processing'].includes(item.status))
    || Object.values(reviewStates).includes('reviewing')
  useEffect(() => {
    if (!hasPendingTutorWork || !topic) return undefined
    let cancelled = false
    let timer
    const refresh = async () => {
      const results = await Promise.allSettled([getTutorReviews(topicNumber), getTutorChatTurns(topicNumber)])
      if (cancelled) return
      if (results[0].status === 'fulfilled') setReviews(results[0].value)
      if (results[1].status === 'fulfilled') {
        const saved = results[1].value
        setChatTurns((current) => [...saved, ...current.filter((turn) =>
          !saved.some((item) => item.client_message_id === turn.client_message_id))])
      }
      timer = setTimeout(refresh, 2500)
    }
    timer = setTimeout(refresh, 2500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [hasPendingTutorWork, topicNumber])

  useLayoutEffect(() => {
    const keepWidthInBounds = () => {
      const workspace = workspaceRef.current
      if (!workspace || workspace.getBoundingClientRect().width < 800) return
      const bounds = tutorWidthBounds(workspace)
      const nextWidth = clampTutorWidth(workspace, preferredTutorPanelWidthRef.current)
      setTutorPanelMaxWidth(bounds.maximum)
      tutorPanelWidthRef.current = nextWidth
      setTutorPanelWidth(nextWidth)
      workspace.style.setProperty('--tutor-panel-width', `${nextWidth}px`)
    }
    keepWidthInBounds()
    const observer = typeof ResizeObserver === 'undefined' ? { observe() {}, disconnect() {} } : new ResizeObserver(keepWidthInBounds)
    if (workspaceRef.current) observer.observe(workspaceRef.current)
    window.addEventListener('resize', keepWidthInBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', keepWidthInBounds)
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current)
      document.documentElement.classList.remove('is-resizing-tutor')
    }
  }, [])

  useEffect(() => {
    if (!topic) return
    document.title = hasQuestions && visibleQuestions.length
      ? `${topic.title} practice - Question ${question.number} - Mathematics 4024`
      : `${topic.title} practice - Mathematics 4024`
    window.scrollTo(0, 0)
  }, [hasQuestions, question.number, topic, visibleQuestions.length])

  if (!topic) return <NotFound />

  const moveTo = (index) => {
    if (!visibleQuestions.length) return
    const nextIndex = Math.max(0, Math.min(visibleQuestions.length - 1, index))
    const nextQuestion = visibleQuestions[nextIndex]
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('question', nextQuestion.id)
    setSearchParams(nextParams)
    setActivePartId(nextQuestion.parts[0].id)
  }

  const updateFilter = (key, value) => {
    const nextParams = new URLSearchParams(searchParams)
    if (value && value !== 'all') nextParams.set(key, value)
    else nextParams.delete(key)
    nextParams.delete('question')
    setSearchParams(nextParams)
    setActivePartId('')
  }

  const applyTutorWidth = (requestedWidth, persist = false) => {
    const workspace = workspaceRef.current
    if (!workspace) return tutorPanelWidthRef.current
    const nextWidth = clampTutorWidth(workspace, requestedWidth)
    tutorPanelWidthRef.current = nextWidth
    workspace.style.setProperty('--tutor-panel-width', `${nextWidth}px`)
    if (persist) {
      preferredTutorPanelWidthRef.current = nextWidth
      setTutorPanelWidth(nextWidth)
      try { localStorage.setItem(TUTOR_WIDTH_STORAGE_KEY, String(nextWidth)) }
      catch { /* The width remains active for this page. */ }
    }
    return nextWidth
  }

  const updateTutorWidthFromPointer = (clientX) => {
    pendingPointerXRef.current = clientX
    if (resizeFrameRef.current !== null) return
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null
      const workspace = workspaceRef.current
      if (!workspace || pendingPointerXRef.current === null) return
      const rightEdge = workspace.getBoundingClientRect().right
      applyTutorWidth(rightEdge - pendingPointerXRef.current)
    })
  }

  const startTutorResize = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    isResizingTutorRef.current = true
    setIsResizingTutor(true)
    setTutorPanelMaxWidth(tutorWidthBounds(workspaceRef.current).maximum)
    document.documentElement.classList.add('is-resizing-tutor')
    event.currentTarget.setPointerCapture(event.pointerId)
    updateTutorWidthFromPointer(event.clientX)
  }

  const moveTutorResize = (event) => {
    if (!isResizingTutorRef.current) return
    event.preventDefault()
    updateTutorWidthFromPointer(event.clientX)
  }

  const finishTutorResize = (event) => {
    if (!isResizingTutorRef.current) return
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = null
    }
    if (event.type !== 'pointercancel') {
      const workspace = workspaceRef.current
      const rightEdge = workspace?.getBoundingClientRect().right || event.clientX
      applyTutorWidth(rightEdge - event.clientX)
    }
    isResizingTutorRef.current = false
    setIsResizingTutor(false)
    preferredTutorPanelWidthRef.current = tutorPanelWidthRef.current
    setTutorPanelWidth(tutorPanelWidthRef.current)
    try { localStorage.setItem(TUTOR_WIDTH_STORAGE_KEY, String(tutorPanelWidthRef.current)) }
    catch { /* The width remains active for this page. */ }
    document.documentElement.classList.remove('is-resizing-tutor')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const resizeTutorWithKeyboard = (event) => {
    const largeStep = event.shiftKey ? 64 : 24
    let nextWidth = tutorPanelWidthRef.current
    if (event.key === 'ArrowLeft') nextWidth += largeStep
    else if (event.key === 'ArrowRight') nextWidth -= largeStep
    else if (event.key === 'Home') nextWidth = MIN_TUTOR_WIDTH
    else if (event.key === 'End') nextWidth = tutorWidthBounds(workspaceRef.current).maximum
    else return
    event.preventDefault()
    applyTutorWidth(nextWidth, true)
  }

  const resetTutorWidth = () => applyTutorWidth(DEFAULT_TUTOR_WIDTH, true)

  const persistAnswer = async (partId, value, status = 'draft') => {
    if (!usesLocalDrafts && (restoreFailedRef.current || conflictsRef.current.has(partId))) {
      throw new Error('Choose which saved answer to keep before saving this draft.')
    }
    const version = (saveVersionsRef.current.get(partId) || 0) + 1
    saveVersionsRef.current.set(partId, version)
    setSaveStates((current) => ({ ...current, [partId]: 'saving' }))
    setSaveMessages((current) => ({ ...current, [partId]: '' }))
    try {
      // Serialize saves so a slow older draft cannot overwrite newer work.
      const previous = saveQueuesRef.current.get(partId) || Promise.resolve()
      const operation = previous.catch(() => {}).then(() => usesLocalDrafts
        ? saveDraft(topic.number, partId, value)
        : saveStudentResponse(partId, value, revisionsRef.current.get(partId) || 0))
      saveQueuesRef.current.set(partId, operation)
      const response = await operation
      revisionsRef.current.set(partId, response.revision)
      if (!usesLocalDrafts && (answersRef.current[partId] || '') === value) {
        try { removeDraft(topic.number, partId, value) } catch { /* Keep the recovery copy if browser storage is unavailable. */ }
        setSubmittedParts((current) => ({ ...current, [partId]: Boolean(response.submitted) }))
      }
      setAttachments((current) => ({ ...current, [partId]: response.attachments }))
      if (saveVersionsRef.current.get(partId) === version) {
        setSaveStates((current) => ({ ...current, [partId]: 'saved' }))
        setSaveMessages((current) => ({
          ...current,
          [partId]: usesLocalDrafts ? 'Saved on this device' : response.submitted ? 'Answer submitted' : 'Saved to your guest workspace',
        }))
      }
      return response
    } catch (error) {
      if (error.status === 409) {
        conflictsRef.current.add(partId)
        getStudentResponses(topic.number).then((responses) => {
          const remote = responses.find((response) => response.question_part_id === partId)
          if (remote) setConflicts((current) => ({ ...current, [partId]: remote }))
        }).catch(() => {})
      }
      if (saveVersionsRef.current.get(partId) === version) {
        setSaveStates((current) => ({ ...current, [partId]: 'error' }))
        setSaveMessages((current) => ({ ...current, [partId]: error.message }))
      }
      throw error
    }
  }

  const changeAnswer = (partId, value) => {
    answersRef.current = { ...answersRef.current, [partId]: value }
    setAnswers(answersRef.current)
    setSubmittedParts((current) => ({ ...current, [partId]: false }))
    saveVersionsRef.current.set(partId, (saveVersionsRef.current.get(partId) || 0) + 1)
    try {
      saveDraft(topic.number, partId, value)
      if (usesLocalDrafts) {
        setSaveStates((current) => ({ ...current, [partId]: 'saved' }))
        setSaveMessages((current) => ({ ...current, [partId]: 'Saved on this device' }))
        return
      }
    } catch {
      setResponseLoadError('Browser recovery storage is unavailable. Keep this page open until your work is saved to the server.')
    }
    setSaveStates((current) => ({ ...current, [partId]: 'saving' }))
    setSaveMessages((current) => ({ ...current, [partId]: '' }))
    clearTimeout(saveTimersRef.current.get(partId))
    const timer = setTimeout(() => {
      saveTimersRef.current.delete(partId)
      persistAnswer(partId, value).catch(() => {})
    }, 800)
    saveTimersRef.current.set(partId, timer)
  }

  const saveNow = (part) => {
    clearTimeout(saveTimersRef.current.get(part.id))
    saveTimersRef.current.delete(part.id)
    persistAnswer(part.id, answersRef.current[part.id] || '').catch(() => {})
  }

  const resolveConflict = (partId, keepLocal) => {
    const remote = conflicts[partId]
    revisionsRef.current.set(partId, remote.revision)
    conflictsRef.current.delete(partId)
    setConflicts((current) => { const next = { ...current }; delete next[partId]; return next })
    if (keepLocal) {
      persistAnswer(partId, answersRef.current[partId] || '').catch(() => {})
    } else {
      clearTimeout(saveTimersRef.current.get(partId))
      saveTimersRef.current.delete(partId)
      answersRef.current = { ...answersRef.current, [partId]: remote.typed_work }
      setAnswers(answersRef.current)
      setAttachments((current) => ({ ...current, [partId]: remote.attachments || [] }))
      setSubmittedParts((current) => ({ ...current, [partId]: Boolean(remote.submitted) }))
      setSaveStates((current) => ({ ...current, [partId]: 'saved' }))
      setSaveMessages((current) => ({ ...current, [partId]: 'Restored saved answer' }))
      try { removeDraft(topic.number, partId, answers[partId]) } catch { /* Recovery copy may remain. */ }
    }
  }

  const submitAnswer = async (part) => {
    if (busyPartsRef.current.has(part.id) || conflictsRef.current.has(part.id) || photoUploads.pendingCount(part.id)) return
    busyPartsRef.current.add(part.id)
    clearTimeout(saveTimersRef.current.get(part.id))
    saveTimersRef.current.delete(part.id)
    const value = answersRef.current[part.id] || ''
    try {
      const saved = await persistAnswer(part.id, value)
      setSaveStates((current) => ({ ...current, [part.id]: 'submitting' }))
      await submitStudentResponse(part.id, saved.revision)
      if ((answersRef.current[part.id] || '') === value) {
        setSubmittedParts((current) => ({ ...current, [part.id]: true }))
        setSaveStates((current) => ({ ...current, [part.id]: 'saved' }))
        setSaveMessages((current) => ({ ...current, [part.id]: 'Answer submitted. You can edit it and submit a new attempt.' }))
      }
    } catch (error) {
      setSaveStates((current) => ({ ...current, [part.id]: 'error' }))
      setSaveMessages((current) => ({ ...current, [part.id]: error.message }))
    } finally { busyPartsRef.current.delete(part.id) }
  }

  const applyPageMutation = (partId, operation, signal) => {
    const previous = saveQueuesRef.current.get(partId) || Promise.resolve()
    const pending = previous.catch(() => {}).then(async () => {
      signal?.throwIfAborted()
      const response = await operation(revisionsRef.current.get(partId))
      signal?.throwIfAborted()
      if (typeof response.typed_work === 'string' && response.typed_work !== (answersRef.current[partId] || '')) {
        const error = new Error('This answer changed in another tab. Choose which saved answer to keep before continuing.')
        error.status = 409
        throw error
      }
      revisionsRef.current.set(partId, response.revision)
      setAttachments((current) => ({ ...current, [partId]: response.attachments }))
      setSubmittedParts((current) => ({ ...current, [partId]: Boolean(response.submitted) }))
      return response
    })
    saveQueuesRef.current.set(partId, pending)
    return pending
  }

  const pageMutationError = (partId, error) => {
    setSaveStates((current) => ({ ...current, [partId]: 'error' }))
    setSaveMessages((current) => ({ ...current, [partId]: error.message }))
    if (error.status === 409) {
      conflictsRef.current.add(partId)
      getStudentResponse(partId).then((remote) => {
        setConflicts((current) => ({ ...current, [partId]: remote }))
      }).catch(() => {})
    }
  }

  const discardUpload = (partId, id) => {
    const item = photoUploads.queues[partId]?.find((candidate) => candidate.id === id)
    if (photoUploads.remove(partId, id) && item?.error === saveMessages[partId]) {
      setSaveStates((current) => ({ ...current, [partId]: 'idle' }))
      setSaveMessages((current) => ({ ...current, [partId]: '' }))
    }
  }

  const deleteImage = async (part, attachmentId) => {
    if (busyPartsRef.current.has(part.id) || conflictsRef.current.has(part.id)) return
    busyPartsRef.current.add(part.id)
    setPageMutations((current) => ({ ...current, [part.id]: true }))
    clearTimeout(saveTimersRef.current.get(part.id))
    saveTimersRef.current.delete(part.id)
    try {
      await persistAnswer(part.id, answersRef.current[part.id] || '')
      setSaveStates((current) => ({ ...current, [part.id]: 'saving' }))
      setSaveMessages((current) => ({ ...current, [part.id]: 'Removing page...' }))
      await applyPageMutation(part.id, (revision) => removeSolutionImage(part.id, attachmentId, revision))
      setSaveStates((current) => ({ ...current, [part.id]: 'saved' }))
      setSaveMessages((current) => ({ ...current, [part.id]: 'Page removed from this draft. Submitted answers keep their pages.' }))
    } catch (error) { pageMutationError(part.id, error) }
    finally {
      busyPartsRef.current.delete(part.id)
      setPageMutations((current) => ({ ...current, [part.id]: false }))
    }
  }

  const askTutor = async (type, part) => {
    if (!hasQuestions || busyPartsRef.current.has(part.id)) return
    if (type === 'hint') {
      return sendTutorMessage(part, 'Please give me one small hint for the next step, without revealing the answer.')
    }
    busyPartsRef.current.add(part.id)
    setReviewErrors((current) => ({ ...current, [part.id]: '' }))
    setActivePartId(part.id)
    clearTimeout(saveTimersRef.current.get(part.id))
    saveTimersRef.current.delete(part.id)
    setReviewStates((current) => ({ ...current, [part.id]: 'reviewing' }))
    try {
      const saved = await persistAnswer(
        part.id,
        answersRef.current[part.id] || '',
        'ready_for_review',
      )
      const review = await requestTutorReview(part.id, saved.revision, type)
      setReviews((current) => {
        const withoutDuplicate = current.filter((item) => item.id !== review.id)
        return [...withoutDuplicate, review].sort((a, b) => a.attempt_number - b.attempt_number)
      })
      setReviewStates((current) => ({ ...current, [part.id]: 'complete' }))
    } catch (error) {
      setReviewStates((current) => ({ ...current, [part.id]: 'error' }))
      setReviewErrors((current) => ({ ...current, [part.id]: error.message }))
      getTutorReviews(topic.number).then(setReviews).catch(() => {})
    } finally {
      busyPartsRef.current.delete(part.id)
    }
  }

  const sendTutorMessage = async (part, message, clientMessageId = crypto.randomUUID()) => {
    if (!hasQuestions || busyPartsRef.current.has(part.id)) return
    busyPartsRef.current.add(part.id)
    setActivePartId(part.id)
    if (saveTimersRef.current.has(part.id)) {
      clearTimeout(saveTimersRef.current.get(part.id))
      saveTimersRef.current.delete(part.id)
      try {
        await persistAnswer(part.id, answersRef.current[part.id] || '')
      } catch {
        // The learner can still ask for help if saving their separate work area fails.
      }
    }
    setChatStates((current) => ({ ...current, [part.id]: 'sending' }))
    setChatTurns((current) => {
      const existing = current.find((turn) => turn.client_message_id === clientMessageId)
      const optimistic = {
        ...(existing || {}),
        id: existing?.id || clientMessageId,
        client_message_id: clientMessageId,
        question_part_id: part.id,
        learner_message: message,
        tutor_message: null,
        status: 'processing',
        error_message: null,
        created_at: existing?.created_at || new Date().toISOString(),
      }
      return [...current.filter((turn) => turn.client_message_id !== clientMessageId), optimistic]
    })
    try {
      const turn = await sendTutorChatMessage(part.id, message, clientMessageId)
      setChatTurns((current) => [
        ...current.filter((item) => item.client_message_id !== clientMessageId),
        turn,
      ])
      setChatStates((current) => ({ ...current, [part.id]: 'complete' }))
    } catch (error) {
      setChatStates((current) => ({ ...current, [part.id]: 'error' }))
      setChatTurns((current) => current.map((turn) => (
        turn.client_message_id === clientMessageId
          ? { ...turn, status: 'failed', error_message: error.message }
          : turn
      )))
      getTutorChatTurns(topic.number).then((restored) => {
        setChatTurns((current) => {
          const transient = current.filter((turn) => (
            !restored.some((item) => item.client_message_id === turn.client_message_id)
            && ['processing', 'failed'].includes(turn.status)
          ))
          return [...restored, ...transient]
        })
      }).catch(() => {})
    } finally {
      busyPartsRef.current.delete(part.id)
    }
  }

  const summary = hasQuestions
    ? 'Choose a question and work through it at your own pace.'
    : isLoading
      ? 'Loading questions'
      : loadError
        ? 'Questions could not be loaded'
        : 'Questions for this topic are coming later'

  return <ReaderShell topic={topic} activeCode="practice" className="practice-shell">
    <div className="reader-main practice-reader-main">
      <div className="practice-topbar">
      <nav className="breadcrumbs" aria-label="Breadcrumb"><ol><li><Link to="/">Topics</Link></li><li><ChevronRight size={14} /></li><li><Link to={`/topic/${topic.number}`}>{topic.title}</Link></li><li><ChevronRight size={14} /></li><li><span aria-current="page">Practice</span></li></ol></nav>
      </div>
      <header className="practice-heading"><div><p>{topic.title.toUpperCase()}</p><h1>Practice questions</h1><span>{summary}</span></div><BookOpenCheck size={32} /></header>
      {isLoading && !hasQuestions && <section className="practice-filters practice-filters-loading" aria-hidden="true">
        <div className="practice-filter-heading"><span className="practice-filter-loading-heading" /></div>
        <div className="practice-filter-controls">
          {Array.from({ length: 3 }, (_, index) => <div className="practice-filter-loading-control" key={index}><span /><span /></div>)}
        </div>
      </section>}
      {hasQuestions && <section className="practice-filters" aria-label="Filter questions">
        <div className="practice-filter-heading"><h2>Find a question</h2></div>
        <div className="practice-filter-controls">
          <label>Subtopic<select value={subtopicFilter} onChange={(event) => updateFilter('subtopic', event.target.value)}><option value="all">All subtopics</option>{topic.subtopics.map((item) => <option value={item.code} key={item.code}>{item.code} {item.title}</option>)}</select></label>
          <label>Paper type<select value={paperFilter} onChange={(event) => updateFilter('paper', event.target.value)}><option value="all">All papers</option><option value="non-calculator">Non-calculator</option><option value="calculator">Calculator</option></select></label>
          <label>Search<input value={searchQuery} onChange={(event) => updateFilter('q', event.target.value)} placeholder="Question title" /></label>
        </div>
      </section>}
      <nav className={`question-picker ${hasQuestions ? '' : 'is-empty'} numbered-question-picker`} aria-label="Choose a question">
        <span>Question</span>
        <div>{visibleQuestions.length ? <><button type="button" className="number-nav-arrow" aria-label="Previous question" onClick={() => moveTo(selectedIndex - 1)} disabled={selectedIndex === 0}><ChevronLeft size={17} /></button>{navigationQuestions.map((item, index) => {
          const number = navigationStart + index + 1
          return <button type="button" key={item.id} className={number === selectedIndex + 1 ? 'active' : ''} aria-label={`Question ${number}: ${item.title}`} aria-current={number === selectedIndex + 1 ? 'step' : undefined} onClick={() => moveTo(number - 1)}>{number}</button>
        })}<button type="button" className="number-nav-arrow" aria-label="Next question" onClick={() => moveTo(selectedIndex + 1)} disabled={selectedIndex === visibleQuestions.length - 1}><ChevronRight size={17} /></button></> : isLoading ? <span className="question-picker-loading" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</span> : <span className="question-picker-empty"><CircleDashed size={16} /> {hasQuestions ? 'No questions match these filters.' : 'No questions available yet'}</span>}</div>
      </nav>
      {!usesLocalDrafts && hasQuestions && <p className="guest-workspace-notice">Your work is saved to a guest workspace in this browser. Clearing browser data removes access. Accounts are coming later.</p>}
      {responseLoadError && <div className="response-load-warning" role="alert">{responseLoadError} <button type="button" onClick={() => window.location.reload()}>Reload saved work</button></div>}
      {!responsesReady && hasQuestions && !responseLoadError && <p role="status">Restoring your saved work…</p>}
      {Object.entries(conflicts).map(([partId, remote]) => <section className="response-load-warning draft-conflict" key={partId} aria-label="Choose saved answer">
        <p>This question part has different local and saved work. Choose which answer to keep.</p>
        <p>Question part: {partId}</p>
        <details><summary>Compare answers</summary><strong>Local draft</strong><pre>{answers[partId]}</pre><strong>Saved answer</strong><pre>{remote.typed_work}</pre></details>
        <button type="button" onClick={() => resolveConflict(partId, true)}>Save my local draft instead</button>
        <button type="button" onClick={() => resolveConflict(partId, false)}>Use saved answer</button>
      </section>)}
      <div
        ref={workspaceRef}
        className={`practice-workspace ${isResizingTutor ? 'is-resizing' : ''}`}
        style={{ '--tutor-panel-width': `${tutorPanelWidth}px` }}
      >
        <div className="practice-question-column">
          {visibleQuestions.length ? <>
            <article className="exam-question" key={question.id}>
              <header className="exam-question-header"><div className="question-number">{selectedIndex + 1}</div><div><p>{question.paper ? (question.paper.calculatorAllowed ? 'CALCULATOR' : 'NON-CALCULATOR') : 'PRACTICE QUESTION'}</p><h2>{question.title}</h2>{question.subtopicCodes && <div className="question-subtopic-tags">{question.subtopicCodes.map((code) => <span key={code}>{topic.subtopics.find((item) => item.code === code)?.title || code}</span>)}</div>}</div><strong>{question.total_marks} marks</strong></header>
              <div className="question-stimulus">{question.prompt.map((block, index) => <QuestionBlock block={block} key={index} />)}</div>
              <div className="question-parts">{question.parts.map((part) => <QuestionPart
                key={part.id}
                part={part}
                answer={answers[part.id] || ''}
                attachments={attachments[part.id] || []}
                saveState={saveStates[part.id] || 'idle'}
                saveMessage={saveMessages[part.id] || ''}
                tutorError={reviewErrors[part.id]}
                tutorBusy={reviewStates[part.id] === 'reviewing' || chatStates[part.id] === 'sending' || reviews.some((item) => item.question_part_id === part.id && ['pending', 'processing'].includes(item.status)) || chatTurns.some((item) => item.question_part_id === part.id && ['pending', 'processing'].includes(item.status))}
                isActive={part.id === activePart.id}
                onAnswerChange={(value) => changeAnswer(part.id, value)}
                onSave={() => saveNow(part)}
                onSubmit={question.capabilities?.submitResponses ? () => submitAnswer(part) : undefined}
                submitted={Boolean(submittedParts[part.id])}
                ready={responsesReady && !pageMutations[part.id] && saveStates[part.id] !== 'submitting'}
                aiEnabled={aiEnabled}
                uploadsEnabled={question.capabilities?.uploads === true}
                onUpload={(files) => photoUploads.enqueue(part.id, files)}
                uploadQueue={photoUploads.queues[part.id] || []}
                uploadBusy={Boolean(pageMutations[part.id])}
                uploadBlocked={conflictsRef.current.has(part.id)}
                onRetryUpload={(id) => photoUploads.retry(part.id, id)}
                onDiscardUpload={(id) => discardUpload(part.id, id)}
                onRemoveAttachment={(attachmentId) => deleteImage(part, attachmentId)}
                onActivate={() => setActivePartId(part.id)}
                onTutorRequest={askTutor}
                localDraftOnly={Boolean(question.localDraftOnly)}
              />)}</div>
            </article>
            <nav className="practice-pagination" aria-label="Question navigation"><button type="button" onClick={() => moveTo(selectedIndex - 1)} disabled={selectedIndex === 0}><ChevronLeft size={18} /> Previous question</button><span>{selectedIndex + 1} of {visibleQuestions.length}</span><button type="button" onClick={() => moveTo(selectedIndex + 1)} disabled={selectedIndex === visibleQuestions.length - 1}>Next question <ChevronRight size={18} /></button></nav>
          </> : <EmptyQuestionCard topic={topic} loading={isLoading} error={loadError} />}
        </div>
        <div
          className="tutor-panel-resizer"
          role="separator"
          aria-label="Resize question and AI tutor panels"
          aria-controls="ai-tutor-panel"
          aria-orientation="vertical"
          aria-valuemin={MIN_TUTOR_WIDTH}
          aria-valuemax={tutorPanelMaxWidth}
          aria-valuenow={tutorPanelWidth}
          aria-valuetext={`AI tutor width ${tutorPanelWidth} pixels`}
          tabIndex="0"
          title="Drag to resize · Double-click to reset"
          onPointerDown={startTutorResize}
          onPointerMove={moveTutorResize}
          onPointerUp={finishTutorResize}
          onPointerCancel={finishTutorResize}
          onKeyDown={resizeTutorWithKeyboard}
          onDoubleClick={resetTutorWidth}
        ><span aria-hidden="true" /></div>
        <AiTutorPanel topic={topic} question={aiEnabled ? question : { ...question, localDraftOnly: true }} displayNumber={selectedIndex + 1} activePart={activePart} reviews={reviews} reviewState={reviewStates[activePart.id] || 'idle'} chatTurns={chatTurns} chatState={chatStates[activePart.id] || 'idle'} onRequest={askTutor} onSendMessage={sendTutorMessage} onRetryMessage={(part, turn) => sendTutorMessage(part, turn.learner_message, turn.client_message_id)} />
      </div>
    </div>
  </ReaderShell>
}
