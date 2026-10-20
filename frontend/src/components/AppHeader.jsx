import { BarChart3, BookOpen, Home, UserRound } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import ThemeToggle from './ThemeToggle.jsx'
import './AppHeader.css'

// Top bar for every screen except the practice workspace. On phones the same
// navigation becomes a tab bar along the bottom of the screen (see AppHeader.css).
export default function AppHeader() {
  const { pathname } = useLocation()
  const inPractice = pathname === '/practice' || pathname.startsWith('/topic/')
  const linkClass = ({ isActive }) => `tb-link${isActive ? ' is-active' : ''}`
  return (
    <header className="tb">
      <div className="tb-inner">
        <Link className="tb-brand" to="/" aria-label="Math Mate home">
          <span className="tb-mark" aria-hidden="true">m²</span>
          <span className="tb-name">Math Mate</span>
        </Link>
        <nav className="tb-nav" aria-label="Main">
          <NavLink to="/" end className={linkClass}><Home size={18} aria-hidden="true" /><span>Home</span></NavLink>
          {/* Practice covers /practice and every topic and subtopic page, so its state is set here. */}
          <Link to="/practice" className={linkClass({ isActive: inPractice })} aria-current={inPractice ? 'page' : undefined}>
            <BookOpen size={18} aria-hidden="true" /><span>Practice</span>
          </Link>
          <NavLink to="/progress" className={linkClass}><BarChart3 size={18} aria-hidden="true" /><span>Progress</span></NavLink>
        </nav>
        <div className="tb-actions">
          <ThemeToggle />
          <span className="tb-guest" title="Your work is saved to a guest workspace in this browser. Accounts are coming later.">
            <span className="tb-guest-icon" aria-hidden="true"><UserRound size={16} /></span>Guest
          </span>
        </div>
      </div>
    </header>
  )
}
