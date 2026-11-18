import { createClient } from '@supabase/supabase-js'

const url = import.meta.env?.VITE_SUPABASE_URL?.replace(/\/$/, '')
const publishableKey = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY

export const authConfigured = Boolean(url && publishableKey)
export const supabase = authConfigured
  ? createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    })
  : null

let testTokenProvider = null

export function setAccessTokenProviderForTests(provider) {
  testTokenProvider = provider
}

export async function getAccessToken() {
  if (testTokenProvider) return testTokenProvider()
  if (!supabase) throw new Error('Supabase sign-in is not configured.')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session?.access_token) {
    const authError = new Error('Please sign in to continue.')
    authError.status = 401
    throw authError
  }
  return data.session.access_token
}
