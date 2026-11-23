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

const CLIENT_MAX_EDGE = 2000
const CLIENT_TARGET_BYTES = 700 * 1024

function canvasBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

export async function prepareImageFile(file) {
  // Small files gain little from a decode/re-encode. The server remains the
  // validation boundary and always strips metadata before Storage.
  if (file.size <= CLIENT_TARGET_BYTES || typeof createImageBitmap !== 'function'
    || typeof document === 'undefined') return file
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    try { bitmap = await createImageBitmap(file) } catch { return file }
  }
  try {
    const scale = Math.min(1, CLIENT_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return file
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    let blob = null
    for (const quality of [0.82, 0.72, 0.62]) {
      blob = await canvasBlob(canvas, quality)
      if (!blob || blob.size <= CLIENT_TARGET_BYTES) break
    }
    if (!blob || blob.size >= file.size) return file
    const name = file.name.replace(/\.[^.]+$/, '') || 'solution-page'
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
  } finally {
    bitmap.close?.()
  }
}
