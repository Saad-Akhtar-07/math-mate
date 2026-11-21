import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import ContentBlockRenderer from '../components/question-renderer/ContentBlockRenderer.jsx'
import { getPaperCounts, getSubtopicQuestions, getTopicQuestions } from './questionBanks.js'
import { syllabus } from './syllabus.js'

const topic6Directory = new URL('../../../data/topic-6-trigonometry/', import.meta.url)

function sourcePaperNames() {
  return readdirSync(topic6Directory).filter((name) => name.endsWith('_trigonometry.json'))
}

function sourcePapers() {
  return sourcePaperNames().map((name) => JSON.parse(readFileSync(new URL(name, topic6Directory), 'utf8')))
}

test('the complete Topic 6 bank is organised and browsable by subtopic and paper type', () => {
  const papers = sourcePapers()
  const calculatorPapers = papers.filter((paper) => paper.collection.source.calculator_allowed)
  const nonCalculatorPapers = papers.filter((paper) => !paper.collection.source.calculator_allowed)
  const questions = getTopicQuestions('6')
  const expectedCount = papers.reduce((sum, paper) => sum + paper.questions.length, 0)
  const subtopics = syllabus.find((topic) => topic.number === '6').subtopics

  expect(papers).toHaveLength(32)
  expect(calculatorPapers).toHaveLength(16)
  expect(nonCalculatorPapers).toHaveLength(16)
  expect(questions).toHaveLength(expectedCount)
  expect(new Set(questions.map((question) => question.id)).size).toBe(expectedCount)
  expect(questions.every((question) => question.id.includes('-t6-'))).toBe(true)
  expect(getPaperCounts('6').calculator).toBe(calculatorPapers.reduce((sum, paper) => sum + paper.questions.length, 0))
  expect(getPaperCounts('6').nonCalculator).toBe(nonCalculatorPapers.reduce((sum, paper) => sum + paper.questions.length, 0))

  for (const question of questions) {
    expect(question.parts.length, question.id).toBeGreaterThan(0)
    expect(question.subtopicCodes.length, question.id).toBeGreaterThan(0)
    for (const code of question.subtopicCodes) {
      expect(subtopics.some((subtopic) => subtopic.code === code), question.id).toBe(true)
      expect(getSubtopicQuestions(code).some((item) => item.id === question.id)).toBe(true)
    }
  }
})

test('every Topic 6 question content block renders cleanly', () => {
  for (const question of getTopicQuestions('6')) {
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
