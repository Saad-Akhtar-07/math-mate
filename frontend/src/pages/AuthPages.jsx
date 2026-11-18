import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { supabase } from '../auth/supabase.js'
import './AuthPages.css'

function AuthShell({ title, subtitle, children }) {
  return <main className="auth-page" id="main-content">
    <section className="auth-card">
      <Link className="auth-brand" to="/">m<sup>2</sup> <span>Math Mate</span></Link>
      <h1>{title}</h1>
      {subtitle && <p className="auth-subtitle">{subtitle}</p>}
      {children}
    </section>
  </main>
}

function AuthForm({ mode }) {
  const signUp = mode === 'signup'
  const navigate = useNavigate()
  const location = useLocation()
  const { session, configured } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  if (session) return <Navigate to={location.state?.from?.pathname || '/'} replace />
  if (!configured) return <AuthShell title="Sign-in is not configured"><p className="auth-error">Add the Supabase URL and publishable key to the frontend environment.</p></AuthShell>

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (signUp && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      if (signUp) {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        })
        if (authError) throw authError
        if (data.session) navigate('/', { replace: true })
        else setSent(true)
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
        if (authError) throw authError
        navigate(location.state?.from?.pathname || '/', { replace: true })
      }
    } catch (authError) {
      setError(authError.message || 'Authentication failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (sent) return <AuthShell title="Check your email" subtitle={`We sent a verification link to ${email}.`}>
    <p className="auth-note">Open the link to verify your email, then Math Mate will sign you in.</p>
    <Link className="auth-primary" to="/sign-in">Back to sign in</Link>
  </AuthShell>

  return <AuthShell title={signUp ? 'Create your account' : 'Welcome back'} subtitle={signUp ? 'Verify your email, then your progress will stay with your account.' : 'Sign in to continue learning.'}>
    <form className="auth-form" onSubmit={submit}>
      <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>Password<input type="password" autoComplete={signUp ? 'new-password' : 'current-password'} minLength="8" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      {signUp && <label>Confirm password<input type="password" autoComplete="new-password" minLength="8" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="auth-primary" type="submit" disabled={busy}>{busy ? 'Please wait...' : signUp ? 'Create account' : 'Sign in'}</button>
    </form>
    {!signUp && <Link className="auth-link" to="/forgot-password">Forgot your password?</Link>}
    <p className="auth-switch">{signUp ? 'Already have an account?' : 'New to Math Mate?'} <Link to={signUp ? '/sign-in' : '/sign-up'}>{signUp ? 'Sign in' : 'Create an account'}</Link></p>
  </AuthShell>
}

export function SignInPage() { return <AuthForm mode="signin" /> }
export function SignUpPage() { return <AuthForm mode="signup" /> }

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
    if (authError) setError(authError.message)
    else setMessage('If that email has an account, a reset link is on its way.')
  }
  return <AuthShell title="Reset your password" subtitle="We will email you a secure reset link.">
    <form className="auth-form" onSubmit={submit}>
      <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {message && <p className="auth-success" role="status">{message}</p>}
      <button className="auth-primary" type="submit">Send reset link</button>
    </form>
    <Link className="auth-link" to="/sign-in">Back to sign in</Link>
  </AuthShell>
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    if (password !== confirmPassword) return setError('Passwords do not match.')
    const { error: authError } = await supabase.auth.updateUser({ password })
    if (authError) setError(authError.message)
    else navigate('/', { replace: true })
  }
  return <AuthShell title="Choose a new password">
    <form className="auth-form" onSubmit={submit}>
      <label>New password<input type="password" autoComplete="new-password" minLength="8" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      <label>Confirm password<input type="password" autoComplete="new-password" minLength="8" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="auth-primary" type="submit">Save new password</button>
    </form>
  </AuthShell>
}

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const finish = async () => {
      const code = searchParams.get('code')
      const result = code ? await supabase.auth.exchangeCodeForSession(code) : await supabase.auth.getSession()
      if (!active) return
      if (result.error) setError(result.error.message)
      else if (result.data.session) navigate('/', { replace: true })
      else setError('The verification link is invalid or expired. Please sign in or request another email.')
    }
    finish()
    return () => { active = false }
  }, [navigate, searchParams])
  return <AuthShell title="Verifying your email">
    {error ? <><p className="auth-error" role="alert">{error}</p><Link className="auth-primary" to="/sign-in">Go to sign in</Link></> : <p className="auth-note" role="status">Please wait...</p>}
  </AuthShell>
}
