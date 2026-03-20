import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export function LoginPage() {
  const { signInWithGoogle, signInWithMicrosoft, sendEmailLink, loading } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('next') || '/'
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)

  async function handleGoogle() {
    setError(null)
    setBusy(true)
    try {
      await signInWithGoogle()
      navigate(next, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleMicrosoft() {
    setError(null)
    setBusy(true)
    try {
      await signInWithMicrosoft()
      navigate(next, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microsoft sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleEmailLink(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError('Enter your email.')
      return
    }
    setBusy(true)
    try {
      await sendEmailLink(email)
      setEmailSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send link')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-600">
        Loading…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 px-4 py-12 text-zinc-900">
      <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Use a real account so your identity on tasks matches your sign-in. After signing in you can open bid
          sessions you have access to.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={handleGoogle}
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            Continue with Google
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleMicrosoft}
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            Continue with Microsoft
          </button>
        </div>

        <div className="relative my-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-200" />
          </div>
          <div className="relative flex justify-center text-xs uppercase text-zinc-500">
            <span className="bg-white px-2">Or email link</span>
          </div>
        </div>

        {emailSent ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">
            Check your inbox for a sign-in link. You can close this tab.
          </p>
        ) : (
          <form onSubmit={handleEmailLink} className="space-y-3">
            <label htmlFor="login-email" className="block text-sm font-medium text-zinc-700">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Email me a link'}
            </button>
          </form>
        )}

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

        <p className="mt-8 text-center text-sm text-zinc-500">
          <Link to="/" className="font-medium text-zinc-700 underline-offset-4 hover:underline">
            Back to home
          </Link>
        </p>
      </div>
    </div>
  )
}
