import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getPendingEmailLinkAddress, isAuthEmailLinkUrl, useAuth } from '../auth/AuthContext'

export function FinishEmailSignInPage() {
  const { completeEmailLinkSignIn, loading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState(() => getPendingEmailLinkAddress() || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !isAuthEmailLinkUrl()) {
      navigate('/login', { replace: true })
    }
  }, [loading, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError('Enter the same email you used to request the link.')
      return
    }
    setBusy(true)
    try {
      await completeEmailLinkSignIn(email)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
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
    <div className="min-h-screen bg-zinc-50 px-4 py-12 text-zinc-900">
      <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold">Complete sign-in</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Enter the email address you used so we can finish the magic link sign-in.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <label htmlFor="finish-email" className="block text-sm font-medium text-zinc-700">
            Email
          </label>
          <input
            id="finish-email"
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
            {busy ? 'Signing in…' : 'Continue'}
          </button>
        </form>
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="font-medium text-zinc-700 underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
