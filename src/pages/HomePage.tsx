import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ProfileForm } from '../components/ProfileForm'
import { getDb } from '../firebase/app'
import { createSession } from '../firebase/sessionApi'
import { getParticipant } from '../lib/participant'
import type { Participant } from '../lib/types'

export function HomePage() {
  const navigate = useNavigate()
  const db = useMemo(() => getDb(), [])
  const [participant, setParticipant] = useState<Participant | null>(() => getParticipant())
  const [title, setTitle] = useState('')
  const [bidLabel, setBidLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)

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
              Enter how you appear in sessions. This stays on this device for refreshes and returns.
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
