import { useState } from 'react'
import type { Participant } from '../lib/types'
import { saveParticipant } from '../lib/participant'

type Props = {
  initial?: Participant | null
  onSaved: (p: Participant) => void
  submitLabel?: string
}

export function ProfileForm({ initial, onSaved, submitLabel = 'Save profile' }: Props) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!displayName.trim()) {
      setError('Display name is required.')
      return
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email.')
      return
    }
    const p = saveParticipant({
      id: initial?.id,
      displayName,
      email,
    })
    onSaved(p)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="displayName" className="block text-sm font-medium text-zinc-700">
          Display name
        </label>
        <input
          id="displayName"
          name="displayName"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:border-zinc-400 focus:ring-2"
        />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-zinc-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:border-zinc-400 focus:ring-2"
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
      >
        {submitLabel}
      </button>
    </form>
  )
}
