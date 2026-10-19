import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseMath } from './tutorText.js'

test('ordinary $...$ maths with LaTeX commands is left untouched', () => {
  // A real tutor reply: backslash commands must never be treated as delimiters.
  const reply = 'Look at $125^{\\frac{1}{3}}$. Since $5 \\times 5 \\times 5 = 125$, we get $125^{\\frac{1}{3}} = 5$.'
  assert.equal(normaliseMath(reply), reply)
})

test('$$...$$ and \\(...\\) become inline $...$', () => {
  assert.equal(normaliseMath('So $$x^{-1} = \\frac{1}{x}$$ here'), 'So $x^{-1} = \\frac{1}{x}$ here')
  assert.equal(normaliseMath('Try \\(5^{-1}\\) and \\(\\frac{1}{5}\\).'), 'Try $5^{-1}$ and $\\frac{1}{5}$.')
})
