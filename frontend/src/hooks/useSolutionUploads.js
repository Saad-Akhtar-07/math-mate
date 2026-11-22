import { useEffect, useRef, useState } from 'react'
import { fileFingerprint } from '../api/uploadTransport.js'

const canRetry = (error) => ![400, 401, 403, 404, 413, 415, 422].includes(error.status)
const pending = (item) => item.status !== 'saved'

export default function useSolutionUploads(options) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [queues, setQueues] = useState({})
  const queueRef = useRef({})
  const active = useRef(new Map())
  const generation = useRef(0)
  const sequence = useRef(0)

  const release = (item) => {
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
  }
  useEffect(() => {
    generation.current++
    queueRef.current = {}
    setQueues({})
    const beforeUnload = (event) => {
      if (Object.values(queueRef.current).some((items) => items.some(pending))) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      generation.current++
      for (const entry of active.current.values()) { entry.controller.abort(); entry.release() }
      active.current.clear()
      Object.values(queueRef.current).flat().forEach(release)
      queueRef.current = {}
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [options.scope])

  const publish = (partId, items) => {
    queueRef.current = { ...queueRef.current, [partId]: items }
    setQueues(queueRef.current)
  }

  const run = async (partId, ids) => {
    const config = optionsRef.current
    if (!ids.length || active.current.has(partId) || !config.canStart(partId)) return
    const controller = new AbortController()
    const { signal } = controller
    const epoch = generation.current
    const entry = { controller, release: () => config.onBusy(partId, false) }
    active.current.set(partId, entry)
    config.onBusy(partId, true)
    const current = () => !signal.aborted && generation.current === epoch
    const find = (id) => queueRef.current[partId]?.find((item) => item.id === id)
    const patch = (id, values) => {
      if (current()) publish(partId, (queueRef.current[partId] || []).map((item) => item.id === id ? { ...item, ...values } : item))
    }
    const saved = (id) => {
      const item = find(id)
      release(item)
      patch(id, { status: 'saved', file: null, previewUrl: '', error: '', uncertain: false })
    }
    let lastResponse
    let processingId = ids[0]
    try {
      patch(processingId, { status: 'preparing', error: '' })
      await config.prepare(partId)
      if (!current()) return
      for (const id of ids) {
        processingId = id
        let item = find(id)
        if (!item || !item.file || item.status === 'saved') continue
        const isRetry = item.attempts > 0
        patch(id, { status: 'preparing', attempts: item.attempts + 1, error: '', percent: null })
        let fingerprint = item.fingerprint
        if (!fingerprint) {
          try { fingerprint = await fileFingerprint(item.file) } catch { /* Server retries still deduplicate without a local checksum. */ }
          if (!current()) return
          patch(id, { fingerprint })
        }
        item = find(id)
        const confirm = async () => {
          patch(id, { status: 'checking', percent: null })
          lastResponse = await config.read(partId, { signal })
          if (!current()) return false
          return !!fingerprint && lastResponse.attachments.some((page) => page.upload_sha256 === fingerprint)
        }
        // A previous request can have committed even if its response was lost.
        if (isRetry && item.uncertain && await confirm()) { saved(id); continue }
        if (!current()) return
        try {
          patch(id, { status: 'uploading', percent: 0 })
          lastResponse = await config.send(partId, item.file, {
            signal, onProgress: ({ phase, percent }) => patch(id, { status: phase, percent }),
          })
          if (!current()) return
          saved(id)
        } catch (failure) {
          if (!current()) return
          let error = failure
          if (failure.uncertain) {
            try {
              if (await confirm()) { saved(id); continue }
            } catch (checkingError) {
              if (!current()) return
              if (checkingError.status === 409) error = checkingError
            }
          }
          patch(id, { status: 'failed', error: error.message, retryable: canRetry(error),
            uncertain: Boolean(failure.uncertain), percent: null })
          config.onError(partId, error)
          // Keep the remaining files waiting instead of repeatedly hitting an
          // offline connection or uploading over a revision conflict.
          break
        }
      }
      if (current() && ids.every((id) => find(id)?.status === 'saved')) config.onComplete(partId, lastResponse)
    } catch (error) {
      if (current()) {
        patch(processingId, { status: 'failed', error: error.message, retryable: canRetry(error), percent: null })
        config.onError(partId, error)
      }
    } finally {
      if (active.current.get(partId) === entry) { active.current.delete(partId); entry.release() }
    }
  }

  const enqueue = (partId, files) => {
    const config = optionsRef.current
    if (!files.length || active.current.has(partId) || !config.canStart(partId)) return
    const remaining = (queueRef.current[partId] || []).filter(pending)
    let validation = ''
    if ((config.attachments[partId] || []).length + remaining.length + files.length > 4) validation = 'You can attach up to 4 pages to one answer.'
    else if (files.some((file) => file.size > 10 * 1024 * 1024)) validation = 'Each original image must be 10 MB or smaller.'
    else if (files.some((file) => file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) validation = 'Choose JPEG, PNG or WebP photos.'
    if (validation) { config.onError(partId, new Error(validation)); return }
    ;(queueRef.current[partId] || []).filter((item) => !pending(item)).forEach(release)
    const added = files.map((file) => ({ id: `photo-${++sequence.current}`, file, name: file.name,
      previewUrl: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '',
      status: 'queued', attempts: 0, percent: null, retryable: true, uncertain: false }))
    publish(partId, [...remaining, ...added])
    void run(partId, added.map((item) => item.id))
  }
  const retry = (partId, itemId) => {
    const items = (queueRef.current[partId] || []).filter((item) =>
      (!itemId || item.id === itemId) && (item.status === 'queued' || (item.status === 'failed' && item.retryable)))
    void run(partId, items.map((item) => item.id))
  }
  const remove = (partId, itemId) => {
    if (active.current.has(partId)) return
    const item = queueRef.current[partId]?.find((candidate) => candidate.id === itemId)
    if (!item || item.status === 'saved' || item.uncertain) return
    release(item)
    publish(partId, queueRef.current[partId].filter((candidate) => candidate.id !== itemId))
    return true
  }
  return { queues, enqueue, retry, remove,
    pendingCount: (partId) => (queueRef.current[partId] || []).filter(pending).length }
}
