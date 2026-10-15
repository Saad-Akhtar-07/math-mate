// Supports the reciprocal-plus-linear form used by the legacy graph renderer.
export function parseFunctionGraphEquation(equation) {
  if (typeof equation !== 'string') return null
  const clean = equation.replaceAll('$', '').replaceAll(' ', '').replace(/^y=/, '')
  const match = clean.match(/^([+-]?\d*(?:\.\d+)?)\/x([+-]\d*(?:\.\d+)?)x$/)
  if (!match) return null
  const reciprocalCoefficient = Number(match[1] || 1)
  const linearCoefficient = Number(match[2] || 1)
  return { reciprocalCoefficient, linearCoefficient }
}
