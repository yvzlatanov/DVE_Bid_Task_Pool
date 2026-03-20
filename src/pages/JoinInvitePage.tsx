import { httpsCallable } from 'firebase/functions'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { getFirebaseFunctions } from '../firebase/app'

export function JoinInvitePage() {
  const { participant, loading: authLoading } = useAuth()
  const [params] = useSearchParams()
  const sessionId = params.get('sessionId') ?? ''
  const inviteId = params.get('inviteId') ?? ''
  const secret = params.get('secret') ?? ''
  const functions = useMemo(() => getFirebaseFunctions(), [])
  const redeemStarted = useRef(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (authLoading || !participant || !functions) return
    if (!sessionId || !inviteId || !secret) {
      setError('Invalid invite link (missing parameters).')
      return
    }
    if (redeemStarted.current) return
    redeemStarted.current = true
    let cancelled = false
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const redeem = httpsCallable<
          { sessionId: string; inviteId: string; secret: string },
          { ok: boolean }
        >(functions, 'redeemSessionInvite')
        await redeem({ sessionId, inviteId, secret })
        if (!cancelled) {
          setDone(true)
          window.location.replace(`/session/${sessionId}`)
        }
      } catch (e) {
        redeemStarted.current = false
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not join with this invite.')
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authLoading, participant, functions, sessionId, inviteId, secret])

  if (authLoading || !participant) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-4 text-center text-sm text-zinc-600">
        {!participant && !authLoading ? (
          <>
            <p>Sign in first to use an invite.</p>
            <Link
              to={`/login?next=${encodeURIComponent(`/join?sessionId=${sessionId}&inviteId=${inviteId}&secret=${encodeURIComponent(secret)}`)}`}
              className="font-medium text-zinc-900 underline"
            >
              Sign in
            </Link>
          </>
        ) : (
          <p>Joining session…</p>
        )}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-4 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <Link to="/" className="text-sm font-medium text-zinc-700 underline">
          Home
        </Link>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-600">
      {busy ? 'Redeeming invite…' : done ? 'Redirecting…' : null}
    </div>
  )
}
