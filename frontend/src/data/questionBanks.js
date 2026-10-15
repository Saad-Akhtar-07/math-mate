import { syllabus } from './syllabus.js'

// Source-data adapter retained for question-rendering tests.
// The running app fetches its question bank from the backend API instead.
const papers = import.meta.glob('../../../data/*.json', { eager: true, import: 'default' })

function firstLeaf(part) {
  return part?.parts?.length ? firstLeaf(part.parts[0]) : part
}

function topicCodeFor(paper, question) {
  const source = paper.collection?.syllabus
  const leaf = firstLeaf(question.parts?.[0])
  const direct = source?.topic?.code || source?.target_bank?.topic_code
    || question.classification?.topic_code || question.bank_alignment?.topic_code
    || leaf?.bank_alignment?.topic_code || leaf?.classification?.topic_code
  if (direct) return String(direct)
  const name = source?.target_bank?.name || question.classification?.topic_name
  return syllabus.find((topic) => topic.title.toLowerCase() === name?.toLowerCase())?.number
}

function leaves(part, parentPrompts = [], parentLabels = []) {
  const prompts = [...parentPrompts, ...(part.prompt || [])]
  const labels = [...parentLabels, part.label].filter(Boolean)
  if (part.parts?.length) return part.parts.flatMap((child) => leaves(child, prompts, labels))
  return [{
    ...part,
    label: labels.join('') || 'Answer',
    prompt: prompts,
    subtopicCode: part.bank_alignment?.subtopic_code || part.classification?.subtopic_code,
  }]
}

const bank = new Map()
for (const [file, paper] of Object.entries(papers)) {
  if (!Array.isArray(paper.questions) || !paper.collection?.source) continue
  const source = paper.collection.source
  for (const question of paper.questions) {
    const topicCode = topicCodeFor(paper, question)
    if (!topicCode) continue
    const parts = question.parts?.length
      ? question.parts.flatMap((part) => leaves(part))
      : leaves({ ...question, id: `${question.id}-main`, label: 'Answer', marks: question.marks ?? question.total_marks, prompt: [] })
    const item = {
      ...question,
      parts,
      topicCode,
      subtopicCodes: [...new Set(parts.map((part) => part.subtopicCode).filter(Boolean))],
      paper: {
        year: source.year,
        session: source.session,
        component: source.component,
        calculatorAllowed: source.calculator_allowed,
        file,
      },
      localDraftOnly: true,
    }
    if (!bank.has(topicCode)) bank.set(topicCode, [])
    bank.get(topicCode).push(item)
  }
}

for (const questions of bank.values()) questions.sort((a, b) =>
  Number(b.paper.year || 0) - Number(a.paper.year || 0)
  || String(a.paper.session || '').localeCompare(String(b.paper.session || ''))
  || String(a.paper.component || '').localeCompare(String(b.paper.component || ''))
  || Number(a.number || 0) - Number(b.number || 0))

const solutions = new Map([...bank.values()].flatMap((questions) => questions.flatMap((question) => question.parts.map((part) => [
  part.id,
  {
    answer: part.mark_scheme?.answer || 'See the marking points below.',
    marking_points: [
      ...(part.mark_scheme?.official_award_structure || []),
      ...(part.mark_scheme?.official_partial_marks || []),
    ].map((point) => ({ code: point.code || '', text: point.text || '' })),
  },
]))))

export function getTopicQuestions(topicNumber) {
  return bank.get(String(topicNumber)) || []
}

export function getSubtopicQuestions(code) {
  return getTopicQuestions(String(code).split('.')[0]).filter((question) => question.subtopicCodes.includes(code))
}

export function getQuestionSolution(partId) {
  return solutions.get(partId) || null
}

export function getPaperCounts(topicNumber) {
  const questions = getTopicQuestions(topicNumber)
  const calculator = questions.filter((question) => question.paper.calculatorAllowed).length
  return { total: questions.length, calculator, nonCalculator: questions.length - calculator }
}

export function getFirstAvailableTopic() {
  return syllabus.find((topic) => getTopicQuestions(topic.number).length > 0)
}
