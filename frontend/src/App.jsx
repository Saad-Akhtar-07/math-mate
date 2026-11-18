import { lazy, Suspense } from 'react'
import { matchPath, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthContext.jsx'
import AppHeader from './components/AppHeader.jsx'
import { useAvailableTopics } from './hooks/useQuestionContent.js'
import { AuthCallbackPage, ForgotPasswordPage, ResetPasswordPage, SignInPage, SignUpPage } from './pages/AuthPages.jsx'

const HomePage = lazy(() => import('./pages/HomePage.jsx'))
const PracticePage = lazy(() => import('./pages/PracticePage.jsx'))
const ProgressPage = lazy(() => import('./pages/ProgressPage.jsx'))
const SubtopicPage = lazy(() => import('./pages/SubtopicPage.jsx'))
const QuestionPracticePage = lazy(() => import('./pages/QuestionPracticePage.jsx'))
const NotFound = lazy(() => import('./pages/NotFound.jsx'))

function RouteLoadingState() {
  return (
    <main className="route-loading" id="main-content" tabIndex="-1">
      <p role="status">Loading page…</p>
    </main>
  )
}

// /practice opens the first topic that has questions.
function PracticeRedirect() {
  const { firstTopic, loading } = useAvailableTopics()
  if (loading) return <RouteLoadingState />
  return <Navigate to={`/topic/${firstTopic?.number || '1'}`} replace />
}

function AuthenticatedApp() {
  // The practice workspace has its own slim header so the question and tutor get the full height.
  const inWorkspace = Boolean(matchPath('/topic/:topicNumber/practice', useLocation().pathname))
  return (
    <div className={`app-shell${inWorkspace ? '' : ' has-tab-bar'}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {!inWorkspace && <AppHeader />}
      <Suspense fallback={<RouteLoadingState />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/practice" element={<PracticeRedirect />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/topic/:topicNumber" element={<PracticePage />} />
          <Route path="/topic/:topicNumber/practice" element={<QuestionPracticePage />} />
          <Route path="/topic/:topicNumber/:subtopicNumber" element={<SubtopicPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </div>
  )
}

function RequireAuth({ children }) {
  const auth = useAuth()
  const location = useLocation()
  if (auth.loading) return <RouteLoadingState />
  if (!auth.configured) return <Navigate to="/sign-in" replace />
  if (!auth.session) return <Navigate to="/sign-in" state={{ from: location }} replace />
  return children
}

export default function App() {
  return <Suspense fallback={<RouteLoadingState />}>
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="*" element={<RequireAuth><AuthenticatedApp /></RequireAuth>} />
    </Routes>
  </Suspense>
}
