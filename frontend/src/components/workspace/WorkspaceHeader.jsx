import { ArrowLeft, ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import ThemeToggle from '../ThemeToggle.jsx'

// The workspace replaces the site header with this slim bar so the question and tutor get the height.
export default function WorkspaceHeader({ backTo, backLabel, position, total, onPrevious, onNext, tutorOpen, onToggleTutor }) {
  return <header className="ws-header">
    <Link className="ws-back" to={backTo}><ArrowLeft size={18} aria-hidden="true" /><span>{backLabel}</span></Link>
    {total > 0 && <nav className="ws-question-nav" aria-label="Question navigation">
      <button type="button" className="ws-icon-button is-bordered" aria-label="Previous question" disabled={position <= 1} onClick={onPrevious}><ChevronLeft size={18} aria-hidden="true" /></button>
      <span><span className="ws-nav-word">Question </span><strong>{position}</strong> of {total}</span>
      <button type="button" className="ws-icon-button is-bordered" aria-label="Next question" disabled={position >= total} onClick={onNext}><ChevronRight size={18} aria-hidden="true" /></button>
    </nav>}
    <div className="ws-header-actions">
      <button type="button" className="ws-tutor-toggle" aria-pressed={tutorOpen} aria-controls="ai-tutor-panel" onClick={onToggleTutor}>
        <MessageCircle size={18} aria-hidden="true" />Tutor
      </button>
      <ThemeToggle />
    </div>
  </header>
}
