import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

function getInitialTheme() {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.dataset.theme || 'light'
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(getInitialTheme)
  const nextTheme = theme === 'light' ? 'dark' : 'light'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    // Matches --bg in theme.css so the browser bar blends with the page.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f1016' : '#f6f5f0')
  }, [theme])

  // Saved only on an explicit choice; until then index.html follows the device setting.
  const chooseTheme = () => {
    setTheme(nextTheme)
    try { localStorage.setItem('syllabus-theme', nextTheme) } catch { /* Theme still works for this session. */ }
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={chooseTheme}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
    >
      {theme === 'light' ? <Moon size={17} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
      <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
    </button>
  )
}
