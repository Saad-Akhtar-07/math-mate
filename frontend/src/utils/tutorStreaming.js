export const TUTOR_STREAM_WORDS_PER_STEP = 1
export const TUTOR_STREAM_STEP_MS = 55
const STREAM_UNIT = /\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\s+|[^\s]+/g

// Preserve every character while grouping complete words. Keeping trailing
// whitespace with its word prevents visible spacing jumps between steps. A
// complete maths expression is one unit so it never flickers as partial LaTeX.
export function tutorStreamChunks(text, wordsPerStep = TUTOR_STREAM_WORDS_PER_STEP) {
  if (!text) return []
  const limit = Math.max(1, wordsPerStep)
  const chunks = []
  let chunk = ''
  let words = 0

  for (const unit of text.match(STREAM_UNIT) || []) {
    chunk += unit
    if (/^\s+$/.test(unit)) {
      if (words >= limit) {
        chunks.push(chunk)
        chunk = ''
        words = 0
      }
    } else {
      words += 1
    }
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

export function prefersReducedTutorMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
