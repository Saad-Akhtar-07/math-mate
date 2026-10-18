import { expect, test } from 'vitest'
import { syllabus } from './syllabus.js'

// Numbered outcomes per subtopic in the Cambridge 4024 syllabus for 2025-2027 (version 2).
// An unnumbered statement counts as one outcome; its code is the subtopic code.
const officialOutcomeCounts = {
  '1.1': 1, '1.2': 1, '1.3': 1, '1.4': 2, '1.5': 1, '1.6': 1, '1.7': 2, '1.8': 3, '1.9': 3, '1.10': 2,
  '1.11': 1, '1.12': 3, '1.13': 5, '1.14': 3, '1.15': 3, '1.16': 2, '1.17': 1, '1.18': 2,
  '2.1': 2, '2.2': 5, '2.3': 2, '2.4': 2, '2.5': 6, '2.6': 4, '2.7': 3, '2.8': 1, '2.9': 4, '2.10': 4, '2.11': 1, '2.12': 3,
  '3.1': 1, '3.2': 1, '3.3': 2, '3.4': 2, '3.5': 1, '3.6': 1, '3.7': 1,
  '4.1': 3, '4.2': 3, '4.3': 2, '4.4': 3, '4.5': 2, '4.6': 3, '4.7': 1, '4.8': 1,
  '5.1': 1, '5.2': 1, '5.3': 2, '5.4': 1, '5.5': 2,
  '6.1': 1, '6.2': 4, '6.3': 2, '6.4': 1,
  '7.1': 4, '7.2': 3, '7.3': 1, '7.4': 4,
  '8.1': 4, '8.2': 2, '8.3': 1,
  '9.1': 1, '9.2': 3, '9.3': 3, '9.4': 1, '9.5': 3, '9.6': 2, '9.7': 2,
}

test('every subtopic lists the official outcomes, one complete statement each', () => {
  const subtopics = syllabus.flatMap((topic) => topic.subtopics)
  expect(Object.fromEntries(subtopics.map((subtopic) => [subtopic.code, subtopic.outcomes.length]))).toEqual(officialOutcomeCounts)
  for (const subtopic of subtopics) {
    for (const outcome of subtopic.outcomes) {
      // Fragments such as "Identify and use:" or "natural numbers" are not outcomes.
      expect(outcome, subtopic.code).toMatch(/^[A-Z]/)
      expect(outcome.endsWith(':'), `${subtopic.code}: ${outcome}`).toBe(false)
      expect(outcome.split(' ').length, `${subtopic.code}: ${outcome}`).toBeGreaterThan(2)
    }
  }
})
