import { httpsCallable } from 'firebase/functions'
import { useMemo, useState } from 'react'
import { getFirebaseFunctions } from '../firebase/app'
import type { MemberRole } from '../lib/types'

type Props = {
  sessionId: string
}

export function SessionInviteSection({ sessionId }: Props) {
  const functions = useMemo(() => getFirebaseFunctions(), [])
  const [role, setRole] = useState<MemberRole>('editor')
  const [maxUses, setMaxUses] = useState(5)
  const [expiresDays, setExpiresDays] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)

  async function handleCreate() {
    if (!functions) {
      setError('Functions not configured.')
      return
    }
    setError(null)
    setBusy(true)
    setInviteUrl(null)
    try {
      const createInvite = httpsCallable<
        { sessionId: string; role: MemberRole; maxUses: number; expiresInDays: number },
        { inviteId: string; secret: string }
      >(functions, 'createSessionInvite')
      const { data } = await createInvite({
        sessionId,
        role: role === 'viewer' ? 'viewer' : 'editor',
        maxUses,
        expiresInDays: expiresDays,
      })
      const url = `${window.location.origin}/join?sessionId=${encodeURIComponent(sessionId)}&inviteId=${encodeURIComponent(data.inviteId)}&secret=${encodeURIComponent(data.secret)}`
      setInviteUrl(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create invite')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 text-sm">
      <h3 className="font-semibold text-zinc-900">Invites (invite-only sessions)</h3>
      <p className="mt-1 text-xs text-zinc-600">
        Generates a one-time style link. Recipients must be signed in, then open the link to join.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div>
          <label className="text-xs font-medium text-zinc-600">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
            className="mt-0.5 w-full rounded border border-zinc-300 px-2 py-1 text-xs"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-600">Max uses</label>
          <input
            type="number"
            min={1}
            max={100}
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value) || 1)}
            className="mt-0.5 w-full rounded border border-zinc-300 px-2 py-1 text-xs"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-600">Expires in (days)</label>
          <input
            type="number"
            min={1}
            max={365}
            value={expiresDays}
            onChange={(e) => setExpiresDays(Number(e.target.value) || 1)}
            className="mt-0.5 w-full rounded border border-zinc-300 px-2 py-1 text-xs"
          />
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleCreate()}
        className="mt-3 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create invite link'}
      </button>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      {inviteUrl ? (
        <div className="mt-3 rounded border border-emerald-200 bg-emerald-50/80 p-2">
          <p className="text-xs font-medium text-emerald-900">Copy and share:</p>
          <p className="mt-1 break-all font-mono text-[10px] text-emerald-950">{inviteUrl}</p>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(inviteUrl)}
            className="mt-2 text-xs font-medium text-emerald-800 underline"
          >
            Copy to clipboard
          </button>
        </div>
      ) : null}
    </div>
  )
}
