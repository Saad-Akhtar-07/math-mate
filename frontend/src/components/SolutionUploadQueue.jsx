import { CheckCircle2, LoaderCircle } from 'lucide-react'

function label(item) {
  if (item.status === 'uploading') return item.percent === null ? 'Uploading…' : `Uploading ${item.percent}%`
  return { queued: 'Waiting', preparing: 'Getting ready…', saving: 'Saving photo…',
    checking: 'Checking saved photo…', saved: 'Saved', failed: 'Not saved' }[item.status]
}

export default function SolutionUploadQueue({ items = [], busy, blocked, onRetry, onRemove }) {
  if (!items.length) return null
  const completed = items.filter((item) => item.status === 'saved').length
  const retryable = items.filter((item) => item.status === 'queued' || (item.status === 'failed' && item.retryable))
  return <section className="solution-upload-queue" aria-label="Photo uploads">
    <p className="solution-upload-summary" role="status">{completed} of {items.length} {items.length === 1 ? 'photo' : 'photos'} saved</p>
    <ul>{items.map((item, index) => {
      const working = ['preparing', 'uploading', 'saving', 'checking'].includes(item.status)
      return <li key={item.id} className={`solution-upload-item is-${item.status}`}>
        {item.previewUrl ? <img className="solution-upload-preview" src={item.previewUrl} alt={`Selected photo ${index + 1}`} />
          : item.status === 'saved' ? <CheckCircle2 size={20} aria-hidden="true" /> : <LoaderCircle size={20} aria-hidden="true" className={working ? 'spin' : undefined} />}
        <div className="solution-upload-details">
          <strong title={item.name}>{item.name || `Photo ${index + 1}`}</strong>
          <span>{label(item)}</span>
          {working && <progress max="100" value={item.status === 'uploading' && item.percent !== null ? item.percent : undefined} aria-label={`Upload progress for ${item.name}`} />}
          {item.error && <p role="alert">{item.error}</p>}
          {item.uncertain && item.status === 'failed' && <small>Retry to confirm whether this photo was saved.</small>}
        </div>
        <div className="solution-upload-actions">
          {item.status === 'failed' && item.retryable && <button type="button" disabled={busy || blocked} onClick={() => onRetry(item.id)} aria-label={`Retry ${item.name}`}>Retry</button>}
          {['queued', 'failed'].includes(item.status) && !item.uncertain && <button type="button" disabled={busy} onClick={() => onRemove(item.id)} aria-label={`Remove selected ${item.name}`}>Remove</button>}
        </div>
      </li>
    })}</ul>
    {!busy && retryable.length > 1 && <button type="button" className="retry-remaining-photos" disabled={blocked} onClick={() => onRetry()}>Retry remaining photos</button>}
    {!busy && retryable.length === 1 && retryable[0].status === 'queued' && <button type="button" className="retry-remaining-photos" disabled={blocked} onClick={() => onRetry()}>Upload remaining photo</button>}
    {completed < items.length && <p className="solution-upload-help">{busy
      ? 'Keep this practice page open until your photos are saved.'
      : 'Retry or remove the remaining photos before submitting. Keep this practice page open to retry.'}</p>}
    {blocked && <p className="solution-upload-help">Choose which saved answer to keep above before retrying.</p>}
  </section>
}
