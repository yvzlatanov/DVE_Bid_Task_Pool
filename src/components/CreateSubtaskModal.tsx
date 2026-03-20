import { useState } from 'react'
import { getDb } from '../firebase/app'
import { createSubtask } from '../firebase/sessionApi'
import type { Participant, TaskLink, TaskPriority } from '../lib/types'

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

type Props = {
  open: boolean
  onClose: () => void
  sessionId: string
  taskId: string
  participant: Participant
}

export function CreateSubtaskModal({ open, onClose, sessionId, taskId, participant }: Props) {
  const db = getDb()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [links, setLinks] = useState<TaskLink[]>([{ url: '', label: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  function reset() {
    setTitle('')
    setDescription('')
    setPriority('medium')
    setLinks([{ url: '', label: '' }])
    setError(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!db) return
    setError(null)
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setBusy(true)
    try {
      await createSubtask(
        db,
        sessionId,
        taskId,
        {
          title,
          description,
          priority,
          links: links
            .map((l) => ({ url: l.url.trim(), label: l.label?.trim() || undefined }))
            .filter((l) => l.url.length > 0),
        },
        participant
      )
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create subtask.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-subtask-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h2 id="create-subtask-title" className="text-base font-semibold">
            New subtask
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          >
            Close
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          <div>
            <label htmlFor="subtask-title" className="block text-sm font-medium text-zinc-700">
              Title
            </label>
            <input
              id="subtask-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400"
            />
          </div>
          <div>
            <label htmlFor="subtask-desc" className="block text-sm font-medium text-zinc-700">
              Description
            </label>
            <textarea
              id="subtask-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400"
            />
          </div>
          <div>
            <label htmlFor="subtask-priority" className="block text-sm font-medium text-zinc-700">
              Priority
            </label>
            <select
              id="subtask-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-700">Links</span>
              <button
                type="button"
                onClick={() => setLinks((prev) => [...prev, { url: '', label: '' }])}
                className="text-sm font-medium text-zinc-700 hover:underline"
              >
                Add link
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {links.map((link, i) => (
                <div key={i} className="flex flex-col gap-2 sm:flex-row">
                  <input
                    placeholder="URL"
                    value={link.url}
                    onChange={(e) => {
                      const next = [...links]
                      next[i] = { ...next[i], url: e.target.value }
                      setLinks(next)
                    }}
                    className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400"
                  />
                  <input
                    placeholder="Label (optional)"
                    value={link.label ?? ''}
                    onChange={(e) => {
                      const next = [...links]
                      next[i] = { ...next[i], label: e.target.value }
                      setLinks(next)
                    }}
                    className="sm:w-40 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400"
                  />
                </div>
              ))}
            </div>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Add to pool'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
