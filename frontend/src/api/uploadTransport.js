// Upload progress measures browser-to-server transfer, not the save itself.
export function uploadMultipart(url, { body, headers, signal, onProgress, timeoutMs = 120000 }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Upload stopped', 'AbortError')); return }
    const xhr = new XMLHttpRequest()
    let settled = false
    const abort = () => xhr.abort()
    const finish = (error, value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      xhr.upload.onprogress = null
      xhr.upload.onload = null
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null
      if (error) reject(error)
      else resolve(value)
    }
    const interrupted = (message) => Object.assign(new Error(message), { uncertain: true })
    xhr.upload.onprogress = (event) => {
      onProgress?.({ phase: 'uploading', percent: event.lengthComputable && event.total > 0
        ? Math.min(100, Math.max(0, Math.round(event.loaded / event.total * 100))) : null })
    }
    xhr.upload.onload = () => onProgress?.({ phase: 'saving', percent: null })
    xhr.onload = () => {
      const data = xhr.response
      if (xhr.status < 200 || xhr.status >= 300) {
        const error = new Error(typeof data?.detail === 'string' ? data.detail : 'The photo could not be saved. Please try again.')
        error.status = xhr.status
        error.uncertain = xhr.status === 0 || xhr.status >= 500 || xhr.status === 408
        finish(error)
      } else if (!data || typeof data !== 'object' || !Array.isArray(data.attachments) || !Number.isInteger(data.revision)) {
        finish(interrupted('We could not confirm that this photo was saved.'))
      } else finish(null, data)
    }
    xhr.onerror = () => finish(interrupted('The connection was interrupted. Please retry the photo.'))
    xhr.ontimeout = () => finish(interrupted('The photo took too long to save. Please retry.'))
    xhr.onabort = () => finish(new DOMException('Upload stopped', 'AbortError'))
    try {
      xhr.open('POST', url)
      xhr.responseType = 'json'
      xhr.timeout = timeoutMs
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) { finish(new DOMException('Upload stopped', 'AbortError')); return }
      onProgress?.({ phase: 'uploading', percent: 0 })
      xhr.send(body)
    } catch (error) { finish(error) }
  })
}

export async function fileFingerprint(file) {
  // Localhost and HTTPS browsers support this; retries remain idempotent on
  // the server if this optional confirmation aid is unavailable.
  if (!globalThis.crypto?.subtle || typeof file.arrayBuffer !== 'function') return null
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
