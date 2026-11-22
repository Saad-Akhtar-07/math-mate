import { ArrowUp, BookOpen, Footprints, Lightbulb, LoaderCircle, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import useTutorSpeech from '../../hooks/useTutorSpeech.js'
import useVoiceInput from '../../hooks/useVoiceInput.js'
import { MAX_ASSISTANCE, TEACHING_MOVE_LABELS } from '../../utils/workspace.js'
import TutorText from '../TutorText.jsx'
import { ReadAloud, VoiceInputPanel, VoiceMicButton, VoicePreferences, VoiceStatus } from '../TutorVoice.jsx'

const isPending = (status) => status === 'pending' || status === 'processing'

function ThinkingBubble({ text }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 10000)
    return () => clearTimeout(timer)
  }, [])
  return <div className="ws-msg is-tutor">
    <span className="ws-msg-label">Thinking</span>
    <div className="ws-bubble ws-thinking"><LoaderCircle className="spin" size={16} aria-hidden="true" />
      {slow ? 'This is taking longer than usual. You can keep working while the tutor finishes.' : text}</div>
  </div>
}

function EmptyState({ availability, partLabel, topicTitle }) {
  const ready = availability === 'ready'
  return <div className="ws-tutor-empty">
    <span className="ws-tutor-avatar is-large" aria-hidden="true">m²</span>
    <h3>{ready ? 'Stuck? I’ll help you think it through.' : availability === 'empty' ? `Your ${topicTitle} tutor` : 'The tutor is not available yet.'}</h3>
    <p>{ready
      ? `Have a go at ${partLabel === 'Answer' ? 'this question' : `part ${partLabel}`} first. When you are ready, press Check my work and I’ll go through your working with you, one step at a time.`
      : availability === 'empty' ? 'When a question is open, I will follow the part you are working on.'
        : 'You can still practise and your work is saved. Hints and feedback will appear here when the tutor is switched on.'}</p>
  </div>
}

export default function TutorPanel({
  className = '', availability, topicTitle, activePart, reviews, reviewState, chatTurns, chatState, help,
  onRequest, onSendMessage, onRetryMessage, onClose,
}) {
  const [chatInput, setChatInput] = useState('')
  const [showVoiceSettings, setShowVoiceSettings] = useState(false)
  const settingsRef = useRef(null)
  const settingsButtonRef = useRef(null)
  const speech = useTutorSpeech(activePart.id)
  const voiceInput = useVoiceInput(activePart.id, speech.stop)
  const awaitingVoice = useRef(new Set())
  const messageEndRef = useRef(null)
  const ready = availability === 'ready'
  const partLabel = activePart.label || 'Answer'
  const partReviews = reviews.filter((review) => review.question_part_id === activePart.id)
  const partTurns = chatTurns.filter((turn) => turn.question_part_id === activePart.id)
  const isReviewing = reviewState === 'reviewing' || partReviews.some((review) => isPending(review.status))
  const isChatting = chatState === 'sending' || partTurns.some((turn) => isPending(turn.status))
  const isBusy = isReviewing || isChatting
  const timeline = [
    ...partReviews.map((review) => ({ kind: 'review', createdAt: review.created_at, value: review })),
    ...partTurns.map((turn) => ({ kind: 'chat', createdAt: turn.created_at, value: turn })),
  ].sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))

  useEffect(() => {
    if (!showVoiceSettings) return undefined
    const dismiss = (event) => {
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

  // Read a reply aloud once it finishes, if the learner turned that on.
  useEffect(() => {
    for (const item of timeline) {
      const key = `${item.kind}:${item.value.client_message_id || item.value.id}`
      if (isPending(item.value.status)) awaitingVoice.current.add(key)
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
    if (!message || isBusy || !ready) return
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

  const subtitle = !ready ? (availability === 'empty' ? 'Waiting for a question' : 'Not available yet')
    : isReviewing ? 'Checking your work' : isChatting ? 'Thinking…' : partLabel === 'Answer' ? 'Helping with this question' : `Helping with part ${partLabel}`

  return <aside className={`ws-tutor ${className}`} id="ai-tutor-panel" aria-label="Tutor">
    <div className="ws-tutor-head">
      <span className="ws-tutor-avatar" aria-hidden="true">m²</span>
      <div className="ws-tutor-title"><h2>Tutor</h2><span>{subtitle}</span></div>
      <button ref={settingsButtonRef} type="button" className="ws-icon-button" aria-label="Voice settings" title="Voice settings"
        aria-expanded={showVoiceSettings} aria-controls="tutor-voice-settings" onClick={() => setShowVoiceSettings((value) => !value)}>
        <Volume2 size={19} aria-hidden="true" />
      </button>
      {onClose && <button type="button" className="ws-icon-button ws-tutor-close" aria-label="Hide tutor" title="Hide tutor" onClick={onClose}><X size={19} aria-hidden="true" /></button>}
    </div>
    {showVoiceSettings && <section ref={settingsRef} className="ws-voice-popover" id="tutor-voice-settings" aria-label="Voice settings">
      <div className="ws-voice-popover-head"><strong>Voice settings</strong>
        <button type="button" className="ws-icon-button" aria-label="Close voice settings" onClick={() => { setShowVoiceSettings(false); settingsButtonRef.current?.focus() }}><X size={16} aria-hidden="true" /></button>
      </div>
      <VoicePreferences speech={speech} />
    </section>}

    {ready && <div className="ws-help">
      <span className="ws-help-name">Help on {partLabel === 'Answer' ? 'this question' : partLabel}</span>
      <span className="ws-help-meter" aria-hidden="true">{Array.from({ length: MAX_ASSISTANCE }, (_, index) => <i key={index} className={index < help.level ? 'is-on' : ''} />)}</span>
      <span className="ws-help-text">{help.level ? `Level ${help.level} of ${MAX_ASSISTANCE} · ${TEACHING_MOVE_LABELS[help.move] || 'Tutor help'}` : 'None yet'}</span>
    </div>}

    <div className="ws-thread" aria-live="polite" aria-busy={isBusy}>
      {timeline.length === 0 && !isBusy ? <EmptyState availability={availability} partLabel={partLabel} topicTitle={topicTitle} />
        : <>
          {timeline.map((item) => item.kind === 'review' ? <div className="ws-review-item" key={`review-${item.value.id}`}>
            <p className="ws-divider"><span>Attempt {item.value.attempt_number} checked{item.value.status === 'completed' && item.value.outcome === 'marked' ? ` · ${item.value.marks_awarded} of ${item.value.marks_maximum}` : ''}</span></p>
            {isPending(item.value.status) ? <ThinkingBubble text="Reading your working…" />
              : <div className={`ws-msg is-tutor${item.value.status === 'failed' ? ' is-error' : ''}`}>
                <span className="ws-msg-label">{item.value.status === 'failed' ? 'Not checked' : 'Feedback'}</span>
                <div className="ws-bubble"><TutorText text={item.value.feedback || item.value.error_message || 'This check did not complete.'} /></div>
                {item.value.status === 'completed' && <ReadAloud speech={speech} type="review" id={item.value.id} disabled={voiceInput.state !== 'idle'} />}
              </div>}
          </div> : <div className="ws-turn" key={`chat-${item.value.client_message_id}`}>
            <div className="ws-msg is-student"><span className="sr-only">You</span><div className="ws-bubble">{item.value.learner_message}</div></div>
            {item.value.status === 'completed' && <div className="ws-msg is-tutor">
              <span className="ws-msg-label">{TEACHING_MOVE_LABELS[item.value.teaching_move] || 'Tutor'}</span>
              <div className="ws-bubble"><TutorText text={item.value.tutor_message} /></div>
              <ReadAloud speech={speech} type="chat" id={item.value.id} disabled={voiceInput.state !== 'idle'} />
            </div>}
            {isPending(item.value.status) && (item.value.tutor_message
              ? <div className="ws-msg is-tutor"><span className="ws-msg-label">{TEACHING_MOVE_LABELS[item.value.teaching_move] || 'Tutor'}</span><div className="ws-bubble"><TutorText text={item.value.tutor_message} /></div></div>
              : <ThinkingBubble text="Preparing useful guidance…" />)}
            {item.value.status === 'failed' && <div className="ws-msg is-tutor is-error" role="alert">
              <span className="ws-msg-label">Message saved</span>
              <div className="ws-bubble">{item.value.error_message || 'I could not answer just now.'}</div>
              <button type="button" className="ws-small-button" disabled={isBusy} onClick={() => onRetryMessage(activePart, item.value)}>Retry</button>
            </div>}
          </div>)}
          {reviewState === 'reviewing' && !partReviews.some((review) => isPending(review.status)) && <ThinkingBubble text="Reading your working…" />}
          <VoiceStatus speech={speech} />
          <div ref={messageEndRef} />
        </>}
    </div>

    <div className="ws-composer">
      {ready && <div className="ws-chips" role="group" aria-label="Quick requests">
        <button type="button" disabled={isBusy} onClick={() => onRequest('hint', activePart)}><Lightbulb size={16} aria-hidden="true" />Give me a hint</button>
        <button type="button" disabled={isBusy} onClick={() => onSendMessage(activePart, 'Please explain the main concept behind this question briefly, without solving it for me.', undefined, 'explain')}><BookOpen size={16} aria-hidden="true" />Explain the idea</button>
        <button type="button" disabled={isBusy} onClick={() => onSendMessage(activePart, 'Please show me just the next step.', undefined, 'show_step')}><Footprints size={16} aria-hidden="true" />Show the next step</button>
      </div>}
      {ready && <VoiceInputPanel input={voiceInput} disabled={isBusy} onUseDraft={(text) => {
        const combined = [chatInput.trim(), text.trim()].filter(Boolean).join('\n')
        if (combined.length > 1000) {
          voiceInput.setDraft({ ...voiceInput.draft, warning: 'The combined message is over 1,000 characters. Shorten the transcript or existing message first.' })
          return
        }
        setChatInput(combined)
        voiceInput.cancel()
      }} />}
      <form className="ws-message-form" onSubmit={submitMessage}>
        <label className="sr-only" htmlFor={`tutor-message-${activePart.id}`}>Message the tutor</label>
        <textarea id={`tutor-message-${activePart.id}`} rows="2" maxLength="1000" value={chatInput}
          onChange={(event) => setChatInput(event.target.value)} onKeyDown={handleComposerKeyDown}
          placeholder={ready ? (partLabel === 'Answer' ? 'Ask about this question…' : `Ask about part ${partLabel}…`) : 'The tutor is not available yet'}
          disabled={!ready || isBusy} />
        {ready && <VoiceMicButton input={voiceInput} disabled={isBusy} />}
        <button type="submit" className="ws-send" aria-label="Send message" title="Send message" disabled={!ready || isBusy || !chatInput.trim()}><ArrowUp size={19} aria-hidden="true" /></button>
      </form>
    </div>
  </aside>
}
