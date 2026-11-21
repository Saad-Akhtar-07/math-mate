import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import ContentBlockRenderer from '../components/question-renderer/ContentBlockRenderer.jsx'
import { getPaperCounts, getSubtopicQuestions, getTopicQuestions } from './questionBanks.js'
import { syllabus } from './syllabus.js'

const topic9Directory = new URL('../../../data/topic-9-statistics/', import.meta.url)

function sourcePapers() {
  return readdirSync(topic9Directory)
    .filter((name) => name.endsWith('_statistics.json'))
    .map((name) => JSON.parse(readFileSync(new URL(name, topic9Directory), 'utf8')))
}

test('the complete Topic 9 bank is organised and browsable by subtopic and paper type', () => {
  const papers = sourcePapers()
  const calculatorPapers = papers.filter((paper) => paper.collection.source.calculator_allowed)
  const nonCalculatorPapers = papers.filter((paper) => !paper.collection.source.calculator_allowed)
  const questions = getTopicQuestions('9')
  const expectedCount = papers.reduce((sum, paper) => sum + paper.questions.length, 0)
  const subtopics = syllabus.find((topic) => topic.number === '9').subtopics

  expect(papers).toHaveLength(32)
  expect(calculatorPapers).toHaveLength(16)
  expect(nonCalculatorPapers).toHaveLength(16)
  expect(questions).toHaveLength(expectedCount)
  expect(new Set(questions.map((question) => question.id)).size).toBe(expectedCount)
  expect(questions.every((question) => question.id.includes('-t9-'))).toBe(true)
  expect(getPaperCounts('9').calculator).toBe(calculatorPapers.reduce((sum, paper) => sum + paper.questions.length, 0))
  expect(getPaperCounts('9').nonCalculator).toBe(nonCalculatorPapers.reduce((sum, paper) => sum + paper.questions.length, 0))

  for (const question of questions) {
    expect(question.parts.length, question.id).toBeGreaterThan(0)
    expect(question.subtopicCodes.length, question.id).toBeGreaterThan(0)
    for (const code of question.subtopicCodes) {
      expect(subtopics.some((subtopic) => subtopic.code === code), question.id).toBe(true)
      expect(getSubtopicQuestions(code).some((item) => item.id === question.id)).toBe(true)
    }
  }
})

test('every Topic 9 question content block renders cleanly', () => {
  for (const question of getTopicQuestions('9')) {
    const blocks = [...question.prompt, ...question.parts.flatMap((part) => part.prompt)]
    expect(blocks.length, `${question.id} has no question content`).toBeGreaterThan(0)
    for (const block of blocks) {
      const markup = renderToStaticMarkup(<ContentBlockRenderer block={block} />)
      expect(markup, `${question.id}: ${block.type}`).not.toContain('unsupported-block')
      expect(markup, `${question.id}: ${block.type} contains invalid maths`).not.toContain('class="math-error"')
      expect(markup, `${question.id}: ${block.type} contains invalid coordinates`).not.toContain('NaN')
      expect(markup, `${question.id}: ${block.type} contains broken characters`).not.toMatch(/Ã|Â|â€|âˆ|ðŸ|�/)
    }
  }
})

test('categorical bars clear the y-axis and the pictogram key stays inside its view box', () => {
  const papers = sourcePapers()
  const pets = papers.flatMap((paper) => paper.questions).find((question) => question.id === '4024-w23-11-t9-q5')
  const barChart = pets.prompt.find((block) => block.id === 'q5-bar-chart')
  const zeroCategory = barChart.x_axis.ticks.find((tick) => tick.label === '0')
  const bars = barChart.elements.filter((element) => element.type === 'rect')

  expect(barChart.x_axis.range[0]).toBe(0)
  expect(zeroCategory.value).toBeGreaterThan(barChart.x_axis.range[0])
  expect(bars.every((bar) => bar.from[0] > barChart.x_axis.range[0])).toBe(true)

  const fruit = papers.flatMap((paper) => paper.questions).find((question) => question.id === '4024-s22-12-t9-q2')
  const pictogram = fruit.prompt.find((block) => block.id === 'q2-pictogram')
  const keyText = pictogram.elements.find((element) => element.type === 'label' && element.text === 'represents 4 people')
  const [originX, , width] = pictogram.view_box
  const estimatedTextRight = keyText.at[0] + keyText.text.length * 7

  expect(estimatedTextRight).toBeLessThan(originX + width)
})
