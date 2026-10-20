import assert from 'node:assert/strict'
import test from 'node:test'
import { comparable, displayLine, markedRows } from './markedWorking.js'

const WORK = '5p + 8 x 75 = 910\n$5p = 1510$\np = 302'
const mistake = (step, fields) => ({ step, type: 'calculation', marks_lost: ['B2'], ...fields })
const verdicts = (rows) => rows.map((row) => [row.kind, row.text, row.verdict])

test('comparison ignores spacing, dollar signs and LaTeX spacing and multiplication forms', () => {
  assert.equal(comparable('$5p = 1510$'), comparable('5p=1510'))
  assert.equal(comparable('3 \\times 4\\,cm'), comparable('3×4 cm'))
  assert.equal(comparable('\\left(x+1\\right) − 2'), '(x+1)-2')
})

test('bare LaTeX lines are shown as maths and others are left alone', () => {
  assert.equal(displayLine('5p + 8 \\times 75 = 910'), '$5p + 8 \\times 75 = 910$')
  assert.equal(displayLine('so $p = \\frac{310}{5}$'), 'so $p = \\frac{310}{5}$')
  assert.equal(displayLine('p = 302'), 'p = 302')
})

test('the quoted line is wrong and the other lines stay neutral', () => {
  const rows = markedRows(WORK, { points: [], mistakes: [mistake('5p=1510')] })
  assert.deepEqual(verdicts(rows), [
    ['line', '5p + 8 x 75 = 910', null], ['line', '$5p = 1510$', 'wrong'], ['line', 'p = 302', null],
  ])
  assert.deepEqual(rows[1].mistakes, [mistake('5p=1510')])
})

test('a quote that is part of a line marks that line', () => {
  const rows = markedRows('so 5p = 1510 and p = 302', { mistakes: [mistake('5p = 1510')] })
  assert.equal(rows[0].verdict, 'wrong')
})

test('full marks tick every line', () => {
  const rows = markedRows('5p + 600 = 910\np = 62', { points: [], mistakes: [] }, true)
  assert.deepEqual(rows.map((row) => row.verdict), ['right', 'right'])
})

test('unmatched quotes and missing steps get their own rows', () => {
  const rows = markedRows(WORK, { mistakes: [mistake('p = 3.02'), mistake('Missing step: rearrange to p = ...')] })
  assert.deepEqual(verdicts(rows).slice(3), [
    ['line', 'p = 3.02', 'wrong'], ['missing', 'rearrange to p = ...', 'wrong'],
  ])
  assert.equal(markedRows('', { mistakes: [mistake('No working shown')] })[0].text, 'No working shown')
})

test('page headings are kept as headings, blank lines dropped, and older attempts stay neutral', () => {
  const rows = markedRows('Typed work:\nx = 2\n\nPhoto page 1:\ny = 3', null)
  assert.deepEqual(verdicts(rows), [
    ['page', 'Typed work', undefined], ['line', 'x = 2', null], ['page', 'Photo page 1', undefined], ['line', 'y = 3', null],
  ])
})
