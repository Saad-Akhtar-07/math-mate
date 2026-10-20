import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/atkinson-hyperlegible-next'
import '@fontsource-variable/bricolage-grotesque'
import 'katex/dist/katex.min.css'
import App from './App.jsx'
import { preloadQuestionContent } from './api/content.js'
import './theme.css'
import './index.css'
import './MathMate.css'

preloadQuestionContent()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
