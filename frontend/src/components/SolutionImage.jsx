import { useEffect, useState } from 'react'
import { getSolutionImageUrl } from '../api/submissions.js'

export default function SolutionImage({ fileId, filename, pageNumber }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    setError('')
    setUrl('')
    getSolutionImageUrl(fileId).then((data) => { if (!cancelled) setUrl(data.url) })
      .catch((failure) => { if (!cancelled) setError(failure.message) })
    return () => { cancelled = true }
  }, [fileId, retry])
  return <div className="solution-page-preview">
    {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry((current) => current + 1)}>Retry image</button></p>
      : url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open page ${pageNumber}: ${filename}`}>
        <img src={url} alt={`Page ${pageNumber}: ${filename}`} onError={() => setError('The image could not be loaded. Please try again.')} />
      </a> : <p role="status">Loading page {pageNumber}…</p>}
  </div>
}
