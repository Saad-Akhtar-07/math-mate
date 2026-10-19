import InlineContent from './notes/InlineContent.jsx'
import { normaliseMath } from '../utils/tutorText.js'

// Tutor feedback and replies with rendered maths. Line breaks are kept by the
// surrounding white-space: pre-wrap style.
export default function TutorText({ text }) {
  if (!text) return null
  return <InlineContent content={normaliseMath(text)} />
}
