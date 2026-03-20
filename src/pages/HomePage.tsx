import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ProfileForm } from '../components/ProfileForm'
import { getDb } from '../firebase/app'
import { createSession } from '../firebase/sessionApi'
import {
  getCreatedSessionsForParticipant,
  getJoinedSessionsForHome,
  recordCreatedSession,
  recordParticipatedSession,
  removeCreatedSession,
  removeParticipatedSession,
} from '../lib/mySessions'
import { getParticipant } from '../lib/participant'
import type { Participant, SessionDoc } from '../lib/types'

type SessionListRow = { sessionId: string; title: string; archived: boolean; missing: boolean }

export function HomePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const db = useMemo(() => getDb(), [])
  const [participant, setParticipant] = useState<Participant | null>(() => getParticipant())
  const [title, setTitle] = useState('')
  const [bidLabel, setBidLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)
  const [createdRows, setCreatedRows] = useState<SessionListRow[]>([])
  const [joinedRows, setJoinedRows] = useState<SessionListRow[]>([])
  const [listsLoading, setListsLoading] = useState(false)

  useEffect(() => {
    if (!db || !participant) {
      setCreatedRows([])
      setJoinedRows([])
      return
    }
    const createdEntries = getCreatedSessionsForParticipant(participant)
    const joinedEntries = getJoinedSessionsForHome(participant)
    if (createdEntries.length === 0 && joinedEntries.length === 0) {
      setCreatedRows([])
      setJoinedRows([])
      return
    }
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
    const firestore = db
    void (async () => {
      const [cr, jr] = await Promise.all([toRows(firestore, createdEntries), toRows(firestore, joinedEntries)])
      if (!cancelled) {
        setCreatedRows(cr)
        setJoinedRows(jr)
        setListsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [db, participant, location.pathname])

  async function handleCreateSession(e: React.FormEvent) {
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
      await createSession(db, sessionId, { title, bidLabel }, participant)
      recordCreatedSession(participant, sessionId, title.trim())
      recordParticipatedSession(participant, sessionId, title.trim())
      navigate(`/session/${sessionId}`)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create session.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 text-zinc-900">
      <header className="border-b border-zinc-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">DVE Constructions</p>
            <h1 className="text-lg font-semibold tracking-tight">Bid task pool</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        {!participant ? (
          <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
            <h2 className="text-base font-semibold">Your profile</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Your email identifies you across browsers and visits (same email = same person on tasks). This device
              remembers your profile for next time.
            </p>
            <div className="mt-6">
              <ProfileForm onSaved={setParticipant} />
            </div>
          </section>
        ) : (
          <div className="space-y-8">
            <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
              {editingProfile ? (
                <>
                  <h2 className="text-base font-semibold">Update profile</h2>
                  <p className="mt-1 text-sm text-zinc-600">Changes apply to new actions in sessions on this device.</p>
                  <div className="mt-6">
                    <ProfileForm
                      initial={participant}
                      submitLabel="Save changes"
                      onSaved={(p) => {
                        setParticipant(p)
                        setEditingProfile(false)
                      }}
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
                    <h2 className="text-base font-semibold">Signed in as</h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      {participant.displayName} · {participant.email}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingProfile(true)}
                    className="shrink-0 text-sm font-medium text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline"
                  >
                    Edit profile
                  </button>
                </div>
              )}
            </section>

            {!editingProfile ? (
              <>
                {getCreatedSessionsForParticipant(participant).length > 0 ? (
                  <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
                    <h2 className="text-base font-semibold">Sessions you started</h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      Stored on this device (including archived). Open to continue or share the link from the session.
                    </p>
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
                    <h2 className="text-base font-semibold">Sessions you joined</h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      Rooms you opened with this email (not ones you started yourself). Includes archived sessions.
                    </p>
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
                    Creates a shareable room. Anyone with the link can join and work from the task pool.
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
                  Have a link? Open it directly — you will be asked for your profile if needed.
                </p>
              </>
            ) : null}
          </div>
        )}
      </main>
    </div>
  )
}
