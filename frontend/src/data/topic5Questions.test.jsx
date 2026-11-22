import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import ContentBlockRenderer from '../components/question-renderer/ContentBlockRenderer.jsx'
import { getPaperCounts, getSubtopicQuestions, getTopicQuestions } from './questionBanks.js'
import { syllabus } from './syllabus.js'

const topic5Directory = new URL('../../../data/topic-5-mensuration/', import.meta.url)

function sourcePapers() {
  return readdirSync(topic5Directory)
    .filter((name) => name.endsWith('_mensuration.json'))
    .map((name) => JSON.parse(readFileSync(new URL(name, topic5Directory), 'utf8')))
}

test('the complete Topic 5 bank is organised and browsable by subtopic and paper type', () => {
  const papers = sourcePapers()
  const calculatorPapers = papers.filter((paper) => paper.collection.source.calculator_allowed)
  const nonCalculatorPapers = papers.filter((paper) => !paper.collection.source.calculator_allowed)
  const questions = getTopicQuestions('5')
  const expectedCount = papers.reduce((sum, paper) => sum + paper.questions.length, 0)
  const subtopics = syllabus.find((topic) => topic.number === '5').subtopics

  expect(papers).toHaveLength(32)
  expect(calculatorPapers).toHaveLength(16)
  expect(nonCalculatorPapers).toHaveLength(16)
  expect(questions).toHaveLength(expectedCount)
  expect(new Set(questions.map((question) => question.id)).size).toBe(expectedCount)
  expect(questions.every((question) => question.id.includes('-t5-'))).toBe(true)
  expect(getPaperCounts('5').calculator).toBe(calculatorPapers.reduce((sum, paper) => sum + paper.questions.length, 0))
  expect(getPaperCounts('5').nonCalculator).toBe(nonCalculatorPapers.reduce((sum, paper) => sum + paper.questions.length, 0))

  for (const question of questions) {
    expect(question.parts.length, question.id).toBeGreaterThan(0)
    expect(question.subtopicCodes.length, question.id).toBeGreaterThan(0)
    for (const code of question.subtopicCodes) {
      expect(subtopics.some((subtopic) => subtopic.code === code), question.id).toBe(true)
      expect(getSubtopicQuestions(code).some((item) => item.id === question.id)).toBe(true)
    }
  }
})

test('every Topic 5 question content block renders cleanly', () => {
  for (const question of getTopicQuestions('5')) {
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
