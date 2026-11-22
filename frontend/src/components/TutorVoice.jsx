import { LoaderCircle, Mic, Square, Volume2 } from 'lucide-react'
import './TutorVoice.css'

export function VoicePreferences({ speech }) {
  return <div className="tutor-voice-preferences">
    <label><input type="checkbox" checked={speech.autoRead} onChange={e => speech.setAutoRead(e.target.checked)} /> Read new replies</label>
    <label><span className="sr-only">Tutor voice</span><select aria-label="Tutor voice" value={speech.voice} onChange={e => { speech.stop(); speech.setVoice(e.target.value) }}><option value="device">Device voice</option><option value="af_heart">Heart · US (local)</option><option value="bf_emma">Emma · UK (local)</option></select></label>
    <label><span className="sr-only">Reading speed</span><select aria-label="Reading speed" value={speech.speed} onChange={e => speech.setSpeed(Number(e.target.value))}><option value="0.8">0.8× speed</option><option value="1">1× speed</option><option value="1.2">1.2× speed</option></select></label>
    {speech.active && <button type="button" onClick={speech.stop}><Square size={13} /> Stop reading</button>}
  </div>
}

export function VoiceStatus({ speech }) {
  if (!speech.status && !speech.notice) return null
  return <div className="voice-playback-status">
    {speech.status && <span className="voice-status" role="status">{speech.status}</span>}
    {speech.spoken && <p className="voice-spoken"><span>Reading now</span>{speech.spoken}</p>}
    {speech.notice && <p className="voice-notice" role="status">{speech.notice}</p>}
  </div>
}

export function ReadAloud({ speech, type, id, disabled }) {
  const playing = speech.active === `${type}:${id}`
  return <div className={`voice-reply-actions${playing ? ' is-reading' : ''}`}>
    <button type="button" disabled={disabled} onClick={() => playing ? speech.stop() : speech.play(type, id)} aria-label={playing ? 'Stop reading this reply' : 'Read this reply aloud'}>{playing ? <Square size={13} /> : <Volume2 size={14} />}{playing ? 'Stop' : 'Read aloud'}</button>
  </div>
}

const VOICE_PRIVACY = 'Audio goes to Groq for transcription. This app does not save recordings. Check your transcript before using it.'

// The mic button that sits in the tutor composer.
export function VoiceMicButton({ input, disabled }) {
  const recording = input.state === 'recording'
  const label = recording ? `Stop recording, ${input.seconds} of 30 seconds`
    : input.state === 'transcribing' ? 'Transcribing your message'
      : input.state === 'permission' ? 'Waiting for microphone permission' : 'Ask by voice'
  return <button type="button" className={`voice-mic-button${recording ? ' is-recording' : ''}`}
    disabled={!recording && (disabled || input.state !== 'idle')} onClick={recording ? input.stop : input.start}
    aria-label={label} title={recording ? label : `${label}. ${VOICE_PRIVACY}`}>
    {recording ? <><Square size={14} aria-hidden="true" /><span aria-hidden="true">{input.seconds}s</span></>
      : input.state === 'idle' ? <Mic size={19} aria-hidden="true" /> : <LoaderCircle className="spin" size={18} aria-hidden="true" />}
  </button>
}

// Recording status, errors and the editable transcript; shown only while voice input is in use.
export function VoiceInputPanel({ input, disabled, onUseDraft }) {
  const busy = input.state !== 'idle'
  if (!busy && !input.canRetry && !input.error && !input.draft) return null
  return <div className="tutor-voice-input">
    {(busy || input.canRetry) && <div className="voice-input-actions">
      <span role="status">{input.state === 'recording' ? `Listening… ${input.seconds}/30s` : input.state === 'transcribing' ? 'Transcribing…' : input.state === 'permission' ? 'Allow the microphone to continue.' : 'Transcript ready'}</span>
      <button type="button" onClick={input.cancel}>Cancel</button>
      {input.canRetry && !busy && <button type="button" disabled={disabled} onClick={input.retry}>Retry for accuracy</button>}
    </div>}
    {input.error && <p className="voice-notice" role="alert">{input.error}</p>}
    {input.draft && <div className="voice-draft">
      <label htmlFor="voice-transcript">Check your transcript</label>
      <textarea id="voice-transcript" rows={3} maxLength={1000} value={input.draft.text} onChange={e => input.setDraft({ ...input.draft, text: e.target.value })} />
      <p>{input.draft.warning} For “one over x plus two”, specify which terms are in the denominator.</p>
      <button type="button" disabled={disabled || busy || !input.draft.text.trim()} onClick={() => onUseDraft(input.draft.text)}>Use in message</button>
    </div>}
    <details className="voice-input-info"><summary>English · 30s max · Voice info</summary><small>{VOICE_PRIVACY}</small></details>
  </div>
}
