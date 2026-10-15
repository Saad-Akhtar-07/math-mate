import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import ContentBlockRenderer from '../components/question-renderer/ContentBlockRenderer.jsx'
import { layoutGraphLabels } from '../utils/graphLabelLayout.js'
import { fitPatternViewBox, validateStandardBlock } from '../utils/standardContentBlocks.js'
import { getPaperCounts, getSubtopicQuestions, getTopicQuestions } from './questionBanks.js'
import { syllabus } from './syllabus.js'

test('the complete Topic 2 bank is browsable by subtopic and paper type', () => {
  const topic2Questions = getTopicQuestions('2')
  const dataDirectory = new URL('../../../data/', import.meta.url)
  const sourcePapers = readdirSync(dataDirectory).filter((name) => name.endsWith('_algebra_and_graphs.json'))
    .map((name) => JSON.parse(readFileSync(new URL(name, dataDirectory), 'utf8')))
  const expectedCount = sourcePapers.reduce((sum, paper) => sum + paper.questions.length, 0)
  expect(topic2Questions).toHaveLength(expectedCount)
  expect(new Set(topic2Questions.map((question) => question.id)).size).toBe(expectedCount)
  const papers2022 = sourcePapers.filter((paper) => paper.collection.source.year === 2022)
  const importedIds = new Set(topic2Questions.map((question) => question.id))
  expect(papers2022).toHaveLength(8)
  expect(papers2022.reduce((sum, paper) => sum + paper.questions.length, 0)).toBe(42)
  for (const paper of papers2022) {
    for (const question of paper.questions) expect(importedIds.has(question.id), question.id).toBe(true)
  }
  expect(getPaperCounts('2').nonCalculator).toBe(sourcePapers.filter((paper) => !paper.collection.source.calculator_allowed).reduce((sum, paper) => sum + paper.questions.length, 0))
  expect(getPaperCounts('2').calculator).toBe(sourcePapers.filter((paper) => paper.collection.source.calculator_allowed).reduce((sum, paper) => sum + paper.questions.length, 0))
  const subtopics = syllabus.find((topic) => topic.number === '2').subtopics
  expect(subtopics.length).toBeGreaterThan(0)
  for (const question of topic2Questions) {
    expect(question.parts.length, question.id).toBeGreaterThan(0)
    expect(question.subtopicCodes.length, question.id).toBeGreaterThan(0)
    for (const code of question.subtopicCodes) {
      expect(subtopics.some((subtopic) => subtopic.code === code), question.id).toBe(true)
      expect(getSubtopicQuestions(code).some((item) => item.id === question.id)).toBe(true)
    }
  }
})

test('all imported question and part content blocks render', () => {
  for (const question of syllabus.flatMap((topic) => getTopicQuestions(topic.number))) {
    const blocks = [...question.prompt, ...question.parts.flatMap((part) => part.prompt)]
    expect(blocks.length, `${question.id} has no question content`).toBeGreaterThan(0)
    for (const block of blocks) {
      const markup = renderToStaticMarkup(<ContentBlockRenderer block={block} />)
      expect(markup, `${question.id}: ${block.type}`).not.toContain('unsupported-block')
      expect(markup, `${question.id}: ${block.type} contains invalid maths`).not.toContain('class="math-error"')
      expect(markup, `${question.id}: ${block.type} contains invalid coordinates`).not.toContain('NaN')
      expect(markup, `${question.id}: ${block.type} contains internal copy or broken characters`).not.toMatch(/source paper|source question|reconstructed from counts|compare with the source|[ÃÂ]/i)
    }
  }
})

test('cross and circle patterns show clear symbols and a blank next pattern', () => {
  const question = getTopicQuestions('2').find((item) => item.id === '4024-w24-12-q9')
  const block = question.prompt.find((item) => item.type === 'pattern_sequence')
  const markup = renderToStaticMarkup(<ContentBlockRenderer block={block} />)
  expect(block.patterns.flatMap((pattern) => pattern.elements.filter((element) => element.type === 'label').map((element) => element.text))).toEqual(Array(18).fill('×'))
  expect(markup).toContain('×')
  expect(markup).toContain('viewBox="20 0 110 110"')
  expect(markup).toContain('Pattern 4 is blank')
  expect(markup).not.toContain('Draw here')
  expect(markup).not.toContain('source paper')
  expect(markup).not.toContain('Ã')
})

test('pattern sequence view boxes expand to include every row', () => {
  const question = getTopicQuestions('2').find((item) => item.id === '4024-w24-12-q9')
  const block = question.prompt.find((item) => item.type === 'pattern_sequence')
  const cramped = { ...block, display_view_box: [30, -3, 90, 90] }
  const [x, y, width, height] = fitPatternViewBox(cramped)
  expect(width).toBe(height)
  expect(x + width).toBeGreaterThan(108)
  expect(y + height).toBeGreaterThan(104)
  expect(renderToStaticMarkup(<ContentBlockRenderer block={cramped} />)).toContain(`viewBox="${x} ${y} ${width} ${height}"`)
})

test('number line ink follows the light or dark theme', () => {
  const markup = renderToStaticMarkup(<ContentBlockRenderer block={{ type: 'number_line', shown_min: -2, shown_max: 8, boundary: { value: 3, endpoint: 'open' }, ray_direction: 'right' }} />)
  expect(markup).toContain('color:var(--diagram-ink)')
  expect(markup).toContain('stroke="currentColor"')
  expect(markup).not.toContain('stroke="black"')
})

test('graph labels on plotted points sit clear of the line', () => {
  const question = getTopicQuestions('2').find((item) => item.id === '4024-s24-11-q9')
  const graph = question.parts.flatMap((part) => part.prompt).find((block) => block.type === 'graph')
  const [xMin, xMax] = graph.x_axis.range
  const [yMin, yMax] = graph.y_axis.range
  const map = ([x, y]) => [70 + (x - xMin) * 440 / (xMax - xMin), 310 - (y - yMin) * 280 / (yMax - yMin)]
  const labels = graph.elements.filter((element) => element.type === 'label')
  const placements = layoutGraphLabels(graph.elements, map)

  expect(labels.map((label) => label.text)).toEqual(['A', 'B', 'C'])
  for (const label of labels) {
    const location = placements.get(label)
    const [pointX, pointY] = map(label.at)
    expect(Math.abs(location.x - pointX), `${label.text} horizontal clearance`).toBeGreaterThanOrEqual(10)
    expect(Math.abs(pointY - location.y), `${label.text} vertical clearance`).toBeGreaterThanOrEqual(12)
    expect(location.x).toBeGreaterThan(5)
    expect(location.x).toBeLessThan(555)
  }

  const markup = renderToStaticMarkup(<ContentBlockRenderer block={graph} />)
  expect(markup.match(/paint-order="stroke"/g)).toHaveLength(labels.length)
  expect(markup).toContain('stroke="var(--diagram-paper)"')
})

test('graph axis annotations already placed off the curve keep their source positions', () => {
  const question = getTopicQuestions('2').find((item) => item.id === '4024-w23-22-q6')
  const graph = question.parts.flatMap((part) => part.prompt).find((block) => block.type === 'graph')
  const [xMin, xMax] = graph.x_axis.range
  const [yMin, yMax] = graph.y_axis.range
  const map = ([x, y]) => [70 + (x - xMin) * 440 / (xMax - xMin), 310 - (y - yMin) * 280 / (yMax - yMin)]
  const placements = layoutGraphLabels(graph.elements, map)
  for (const label of graph.elements.filter((element) => element.type === 'label')) {
    expect([placements.get(label).x, placements.get(label).y]).toEqual(map(label.at))
  }
})

test('all imported graph labels remain inside their SVG viewport', () => {
  for (const question of syllabus.flatMap((topic) => getTopicQuestions(topic.number))) {
    const graphs = [...question.prompt, ...question.parts.flatMap((part) => part.prompt)].filter((block) => block.type === 'graph')
    for (const graph of graphs) {
      const [xMin, xMax] = graph.x_axis.range
      const [yMin, yMax] = graph.y_axis.range
      const map = ([x, y]) => [70 + (x - xMin) * 440 / (xMax - xMin), 310 - (y - yMin) * 280 / (yMax - yMin)]
      const positions = layoutGraphLabels(graph.elements || [], map)
      for (const label of (graph.elements || []).filter((element) => element.type === 'label')) {
        const { x, y, anchor } = positions.get(label)
        const width = Math.max(8, String(label.text).length * 7.2)
        const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x
        expect(left, `${question.id}: ${label.text}`).toBeGreaterThanOrEqual(0)
        expect(left + width, `${question.id}: ${label.text}`).toBeLessThanOrEqual(560)
        expect(y - 13, `${question.id}: ${label.text}`).toBeGreaterThanOrEqual(0)
        expect(y + 3, `${question.id}: ${label.text}`).toBeLessThanOrEqual(365)
      }
    }
  }
})

test('curated graph labels can use a checked manual offset', () => {
  const label = { type: 'label', at: [20, 30], text: 'A', offset: [12, -16] }
  expect(layoutGraphLabels([label], (point) => point).get(label)).toEqual({ x: 32, y: 14, anchor: 'middle' })
  expect(validateStandardBlock({ type: 'graph', x_axis: { range: [0, 10] }, y_axis: { range: [0, 10] }, elements: [{ ...label, offset: ['wrong', 0] }] })).toContain('Invalid graph label offset')
})
