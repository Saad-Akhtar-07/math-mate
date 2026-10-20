// Pure helpers for the "How it was marked" panel: the student's lines as the Marker
// read them, matched to the steps that lost marks in the assessment's review.

export const MISTAKE_TYPE_LABELS = {
  conceptual: 'Concept',
  method: 'Method',
  calculation: 'Calculation slip',
  notation: 'Notation',
  reading: 'Misread the question',
}

// The Marker reads typed work first, then each photo page, and may head each part.
const PAGE_HEADING = /^(?:(?:photo\s+)?page\s+\d+|typed\s+work(?:ing)?)\s*:?\s*$/i
const MISSING = /^\s*(?:missing|no working|not shown|omitted)\b/i
const MISSING_PREFIX = /^\s*missing(?:\s+step)?\s*[:\-–]\s*/i

/** Lower-case text without spacing, $ delimiters or LaTeX spacing commands, for comparing lines. */
export function comparable(text) {
  return String(text || '').toLowerCase()
    .replace(/\\(?:left|right|displaystyle)\b/g, '')
    .replace(/\\[,;:! ]/g, '')
    .replace(/\\(?:times|cdot)\b|×|·/g, '*')
    .replace(/−/g, '-')
    .replace(/[\s$]/g, '')
}

/** A line with LaTeX commands but no $ delimiters, as models sometimes write it, rendered as maths. */
export function displayLine(text) {
  return /\\[a-z]+/i.test(text) && !text.includes('$') ? `$${text}$` : text
}

function findLine(lines, step) {
  const target = comparable(step)
  if (!target) return -1
  const exact = lines.findIndex((line) => line.key === target)
  if (exact >= 0) return exact
  // A quote may be part of a line, or span a line and a little more.
  return lines.findIndex((line) => Math.min(line.key.length, target.length) >= 3
    && (line.key.includes(target) || target.includes(line.key)))
}

/**
 * Rows for the panel: page headings, the student's lines, then any mistake that quotes
 * no line. A quoted line is wrong. With full marks every line is right; otherwise other
 * lines stay neutral, because the Marker does not judge each line on its own.
 */
export function markedRows(whatIRead, review, fullMarks = false) {
  const rows = String(whatIRead || '').split('\n').map((text) => text.trim()).filter(Boolean)
    .map((text) => (PAGE_HEADING.test(text)
      ? { kind: 'page', text: text.replace(/\s*:\s*$/, '') }
      : { kind: 'line', text, key: comparable(text), verdict: fullMarks ? 'right' : null, mistakes: [] }))
  const lines = rows.filter((row) => row.kind === 'line')
  for (const mistake of review?.mistakes || []) {
    const index = findLine(lines, mistake.step)
    if (index >= 0) {
      lines[index].verdict = 'wrong'
      lines[index].mistakes.push(mistake)
    } else if (MISSING.test(mistake.step)) {
      rows.push({ kind: 'missing', text: mistake.step.replace(MISSING_PREFIX, ''), verdict: 'wrong', mistakes: [mistake] })
    } else {
      rows.push({ kind: 'line', text: mistake.step, verdict: 'wrong', mistakes: [mistake] })
    }
  }
  return rows.map(({ key, ...row }) => row)
}
