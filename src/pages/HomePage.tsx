import { doc, getDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ProfileForm } from '../components/ProfileForm'
import { getDb } from '../firebase/app'
import { createSession, fetchSessionIdsForMember } from '../firebase/sessionApi'
import {
  getCreatedSessionsForParticipant,
  getJoinedSessionsForHome,
  recordCreatedSession,
  recordParticipatedSession,
  removeCreatedSession,
  removeParticipatedSession,
} from '../lib/mySessions'
import type { SessionAccessMode, SessionDoc } from '../lib/types'

type SessionListRow = { sessionId: string; title: string; archived: boolean; missing: boolean }

export function HomePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { participant, signOut } = useAuth()
  const db = useMemo(() => getDb(), [])
  const [title, setTitle] = useState('')
  const [bidLabel, setBidLabel] = useState('')
  const [accessMode, setAccessMode] = useState<SessionAccessMode>('link_join')
  const [linkExpiry, setLinkExpiry] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)
  const [createdRows, setCreatedRows] = useState<SessionListRow[]>([])
  const [joinedRows, setJoinedRows] = useState<SessionListRow[]>([])
  const [memberRows, setMemberRows] = useState<SessionListRow[]>([])
  const [listsLoading, setListsLoading] = useState(false)

  useEffect(() => {
    if (!db || !participant) {
      setCreatedRows([])
      setJoinedRows([])
      setMemberRows([])
      return
    }
    const createdEntries = getCreatedSessionsForParticipant(participant)
    const joinedEntries = getJoinedSessionsForHome(participant)
    let cancelled = false
    setListsLoading(true)

    async function toRows(
      firestore: NonNullable<typeof db>,
      entries: { sessionId: string; title: string }[]
    ): Promise<SessionListRow[]> {
      return Promise.all(
        entries.map(async (e) => {
          try {
            const snap = await getDoc(doc(firestore, 'sessions', e.sessionId))
            if (!snap.exists()) {
              return { sessionId: e.sessionId, title: e.title, archived: false, missing: true }
            }
            const s = snap.data() as SessionDoc
            return {
              sessionId: e.sessionId,
              title: s.title || e.title,
              archived: s.status === 'archived',
              missing: false,
            }
          } catch {
            return { sessionId: e.sessionId, title: e.title, archived: false, missing: true }
          }
        })
      )
    }

    void (async () => {
      let ids: string[] = []
      try {
        ids = await fetchSessionIdsForMember(db, participant.id)
      } catch {
        ids = []
      }
      const memberMeta = await Promise.all(
        ids.map(async (sessionId) => {
          try {
            const snap = await getDoc(doc(db, 'sessions', sessionId))
            if (!snap.exists()) {
              return { sessionId, title: sessionId, archived: false, missing: true as const }
            }
            const s = snap.data() as SessionDoc
            return {
              sessionId,
              title: s.title,
              archived: s.status === 'archived',
              missing: false as const,
            }
          } catch {
            return { sessionId, title: sessionId, archived: false, missing: true as const }
          }
        })
      )
      const [cr, jr] = await Promise.all([toRows(db, createdEntries), toRows(db, joinedEntries)])
      if (!cancelled) {
        setCreatedRows(cr)
        setJoinedRows(jr)
        setMemberRows(
          memberMeta.map((m) => ({
            sessionId: m.sessionId,
            title: m.title,
            archived: m.archived,
            missing: m.missing,
          }))
        )
        setListsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [db, participant, location.pathname])

  const handleCreateSession = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setFormError(null)
      if (!db || !participant) return
      if (!title.trim()) {
        setFormError('Session title is required.')
        return
      }
      setBusy(true)
      try {
        const sessionId = crypto.randomUUID()
        let linkExpiresAt: Date | null = null
        if (accessMode === 'link_join' && linkExpiry.trim()) {
          const d = new Date(linkExpiry)
          if (!Number.isNaN(d.getTime())) linkExpiresAt = d
        }
        await createSession(db, sessionId, { title, bidLabel, accessMode, linkExpiresAt }, participant)
        recordCreatedSession(participant, sessionId, title.trim())
        recordParticipatedSession(participant, sessionId, title.trim())
        navigate(`/session/${sessionId}`)
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Could not create session.')
      } finally {
        setBusy(false)
      }
    },
    [db, participant, title, bidLabel, accessMode, linkExpiry, navigate]
  )

  if (!participant) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-zinc-50 to-zinc-100 text-zinc-900">
        <p className="text-sm text-zinc-600">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 text-zinc-900">
      <header className="border-b border-zinc-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">DVE Constructions</p>
            <h1 className="text-lg font-semibold tracking-tight">Bid task pool</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-zinc-600">{participant.displayName}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="space-y-8">
          <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
            {editingProfile ? (
              <>
                <h2 className="text-base font-semibold">Display name</h2>
                <p className="mt-1 text-sm text-zinc-600">Shown on tasks and comments (your sign-in stays the same).</p>
                <div className="mt-6">
                  <ProfileForm
                    submitLabel="Save changes"
                    onSaved={() => setEditingProfile(false)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setEditingProfile(false)}
                  className="mt-4 text-sm font-medium text-zinc-600 hover:text-zinc-900"
                >
                  Cancel
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold">Account</h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    {participant.displayName} · {participant.email || 'No email on account'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingProfile(true)}
                  className="shrink-0 text-sm font-medium text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline"
                >
                  Edit display name
                </button>
              </div>
            )}
          </section>

          {!editingProfile ? (
            <>
              {memberRows.length > 0 ? (
                <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
                  <h2 className="text-base font-semibold">Your sessions (from account)</h2>
                  <p className="mt-1 text-sm text-zinc-600">Every session where you are a member.</p>
                  {listsLoading ? (
                    <p className="mt-4 text-sm text-zinc-500">Loading…</p>
                  ) : (
                    <ul className="mt-4 divide-y divide-zinc-100">
                      {memberRows.map((row) => (
                        <li key={row.sessionId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                          <div className="min-w-0">
                            <p className="font-medium text-zinc-900">{row.title}</p>
                            <p className="text-xs text-zinc-500">
                              {row.missing
                                ? 'Not found'
                                : row.archived
                                  ? 'Archived'
                                  : 'Active'}
                            </p>
                          </div>
                          {!row.missing ? (
                            <Link
                              to={`/session/${row.sessionId}`}
                              className="shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
                            >
                              Open
                            </Link>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}

              {getCreatedSessionsForParticipant(participant).length > 0 ? (
                <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
                  <h2 className="text-base font-semibold">Sessions you started (this device)</h2>
                  <p className="mt-1 text-sm text-zinc-600">Local shortcuts; membership is stored in Firebase.</p>
                  {listsLoading ? (
                    <p className="mt-4 text-sm text-zinc-500">Loading…</p>
                  ) : (
                    <ul className="mt-4 divide-y divide-zinc-100">
                      {createdRows.map((row) => (
                        <li key={row.sessionId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                          <div className="min-w-0">
                            <p className="font-medium text-zinc-900">{row.title}</p>
                            <p className="text-xs text-zinc-500">
                              {row.missing
                                ? 'Not found (removed or no access)'
                                : row.archived
                                  ? 'Archived'
                                  : 'Active'}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            {!row.missing ? (
                              <Link
                                to={`/session/${row.sessionId}`}
                                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
                              >
                                Open
                              </Link>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => {
                                removeCreatedSession(row.sessionId)
                                setCreatedRows((prev) => prev.filter((r) => r.sessionId !== row.sessionId))
                              }}
                              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                            >
                              Remove from list
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}

              {getJoinedSessionsForHome(participant).length > 0 ? (
                <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
                  <h2 className="text-base font-semibold">Sessions you joined (this device)</h2>
                  {listsLoading ? (
                    <p className="mt-4 text-sm text-zinc-500">Loading…</p>
                  ) : (
                    <ul className="mt-4 divide-y divide-zinc-100">
                      {joinedRows.map((row) => (
                        <li key={row.sessionId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                          <div className="min-w-0">
                            <p className="font-medium text-zinc-900">{row.title}</p>
                            <p className="text-xs text-zinc-500">
                              {row.missing
                                ? 'Not found (removed or no access)'
                                : row.archived
                                  ? 'Archived'
                                  : 'Active'}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            {!row.missing ? (
                              <Link
                                to={`/session/${row.sessionId}`}
                                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
                              >
                                Open
                              </Link>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => {
                                removeParticipatedSession(row.sessionId)
                                setJoinedRows((prev) => prev.filter((r) => r.sessionId !== row.sessionId))
                              }}
                              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                            >
                              Remove from list
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}

              <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
                <h2 className="text-base font-semibold">Start a bid session</h2>
                <p className="mt-1 text-sm text-zinc-600">
                  You become the admin. Choose how others join: open link (with optional expiry) or invite-only
                  (Firebase Function invite links).
                </p>
                <form onSubmit={handleCreateSession} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="sessionTitle" className="block text-sm font-medium text-zinc-700">
                      Session title
                    </label>
                    <input
                      id="sessionTitle"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Smith Tower bid — March 2026"
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:border-zinc-400 focus:ring-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="bidLabel" className="block text-sm font-medium text-zinc-700">
                      Bid label (optional)
                    </label>
                    <input
                      id="bidLabel"
                      value={bidLabel}
                      onChange={(e) => setBidLabel(e.target.value)}
                      placeholder="Project or bid code"
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:border-zinc-400 focus:ring-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="accessMode" className="block text-sm font-medium text-zinc-700">
                      Access
                    </label>
                    <select
                      id="accessMode"
                      value={accessMode}
                      onChange={(e) => setAccessMode(e.target.value as SessionAccessMode)}
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2"
                    >
                      <option value="link_join">Anyone signed in with the link can join as editor</option>
                      <option value="invite_only">Invite only (use Invites in the session after creation)</option>
                    </select>
                  </div>
                  {accessMode === 'link_join' ? (
                    <div>
                      <label htmlFor="linkExpiry" className="block text-sm font-medium text-zinc-700">
                        Link expires (optional, local time)
                      </label>
                      <input
                        id="linkExpiry"
                        type="datetime-local"
                        value={linkExpiry}
                        onChange={(e) => setLinkExpiry(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2"
                      />
                    </div>
                  ) : null}
                  {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                  >
                    {busy ? 'Creating…' : 'Create session'}
                  </button>
                </form>
              </section>

              <p className="text-center text-sm text-zinc-500">
                Have a link? Open it while signed in — you will join automatically if the session allows it.
              </p>
            </>
          ) : null}
        </div>
      </main>
    </div>
  )
}
