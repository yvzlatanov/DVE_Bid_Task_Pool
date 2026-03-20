import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'

type Props = {
  submitLabel?: string
  onSaved?: () => void
}

/** Updates Firebase Auth display name (not identity). */
export function ProfileForm({ submitLabel = 'Save', onSaved }: Props) {
  const { user, updateDisplayName } = useAuth()
  const [name, setName] = useState(user?.displayName ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(user?.displayName ?? '')
  }, [user?.uid, user?.displayName])
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setBusy(true)
    try {
      await updateDisplayName(name.trim())
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="display-name" className="block text-sm font-medium text-zinc-700">
          Display name
        </label>
        <input
          id="display-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400"
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
      >
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
