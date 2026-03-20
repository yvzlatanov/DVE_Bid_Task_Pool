import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CreateTaskModal } from '../components/CreateTaskModal'
import { ProfileForm } from '../components/ProfileForm'
import { TaskCard } from '../components/TaskCard'
import { TaskDetailModal } from '../components/TaskDetailModal'
import { getDb } from '../firebase/app'
import {
  archiveSession,
  exportSessionSnapshot,
  subscribeSession,
  subscribeTasks,
} from '../firebase/sessionApi'
import { getParticipant } from '../lib/participant'
import type { Participant, SessionDoc, TaskDoc, TaskStatus } from '../lib/types'

const COLUMNS: { status: TaskStatus; label: string; hint: string }[] = [
  { status: 'pooled', label: 'Pool', hint: 'Unclaimed work' },
  { status: 'in_progress', label: 'In progress', hint: 'Someone is on it' },
  { status: 'blocked', label: 'Blocked', hint: 'Needs attention' },
  { status: 'done', label: 'Done', hint: 'Completed' },
]

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const db = useMemo(() => getDb(), [])

  const [participant, setParticipant] = useState<Participant | null>(() => getParticipant())
  const [session, setSession] = useState<SessionDoc | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<{ id: string; data: TaskDoc }[]>([])
  const [tasksError, setTasksError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)

  const sid = sessionId ?? ''

  useEffect(() => {
    if (!db || !sid) return
    setSessionReady(false)
    setSessionError(null)
    return subscribeSession(
      db,
      sid,
      (data) => {
        setSessionReady(true)
        setSession(data)
      },
      (err) => {
        setSessionReady(true)
        setSessionError(err.message)
      }
    )
  }, [db, sid])

  useEffect(() => {
    if (!db || !sid) return
    setTasksError(null)
    return subscribeTasks(
      db,
      sid,
      (list) => setTasks(list),
      (err) => setTasksError(err.message)
    )
  }, [db, sid])

  const copyLink = useCallback(() => {
    const url = `${window.location.origin}/session/${sid}`
    void navigator.clipboard.writeText(url).then(
      () => {
        setBanner('Session link copied to clipboard.')
        setTimeout(() => setBanner(null), 3200)
      },
      () => setBanner('Could not copy link. Copy from the address bar.')
    )
  }, [sid])

  const handleExport = useCallback(async () => {
    if (!db || !sid) return
    setExportBusy(true)
    try {
      const data = await exportSessionSnapshot(db, sid)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `bid-session-${sid}.json`
      a.click()
      URL.revokeObjectURL(href)
      setBanner('Export downloaded.')
      setTimeout(() => setBanner(null), 3200)
    } catch {
      setBanner('Export failed. Check your connection and rules.')
    } finally {
      setExportBusy(false)
    }
  }, [db, sid])

  const handleArchive = useCallback(async () => {
    if (!db || !sid || !participant) return
    if (!window.confirm('Archive this session? New tasks and edits will be disabled for everyone.')) {
      return
    }
    setArchiveBusy(true)
    try {
      await archiveSession(db, sid, participant)
      setBanner('Session archived.')
      setTimeout(() => setBanner(null), 3200)
    } catch {
      setBanner('Could not archive. Check permissions.')
    } finally {
      setArchiveBusy(false)
    }
  }, [db, sid, participant])

  if (!participant) {
    return (
      <div className="min-h-screen bg-zinc-50 px-4 py-12 text-zinc-900">
        <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <h1 className="text-lg font-semibold">Join this session</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Enter your name and email so teammates can see who is on each task.
          </p>
          <div className="mt-6">
            <ProfileForm submitLabel="Continue" onSaved={setParticipant} />
          </div>
          <p className="mt-6 text-center text-sm">
            <Link to="/" className="font-medium text-zinc-700 underline-offset-4 hover:underline">
              Back to home
            </Link>
          </p>
        </div>
      </div>
    )
  }

  if (!db || !sid) {
    return (
      <div className="min-h-screen bg-zinc-50 p-8 text-center text-sm text-zinc-600">
        Invalid session link.
      </div>
    )
  }

  if (!sessionReady) {
    return (
      <div className="min-h-screen bg-zinc-50 p-8 text-center text-sm text-zinc-600">Loading session…</div>
    )
  }

  if (sessionError) {
    return (
      <div className="min-h-screen bg-zinc-50 p-8 text-center text-sm text-red-600">
        {sessionError}
        <div className="mt-4">
          <Link to="/" className="font-medium text-zinc-700 underline">
            Home
          </Link>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-zinc-50 p-8 text-center text-sm text-zinc-600">
        This session does not exist or was removed.
        <div className="mt-4">
          <Link to="/" className="font-medium text-zinc-700 underline">
            Home
          </Link>
        </div>
      </div>
    )
  }

  const archived = session.status === 'archived'
  const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : undefined

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Bid session</p>
            <h1 className="truncate text-xl font-semibold tracking-tight">{session.title}</h1>
            {session.bidLabel ? (
              <p className="mt-1 text-sm text-zinc-600">{session.bidLabel}</p>
            ) : null}
            {archived ? (
              <p className="mt-2 text-sm font-medium text-amber-800">Archived — read only</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyLink}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Copy link
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exportBusy}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              {exportBusy ? 'Exporting…' : 'Export JSON'}
            </button>
            {!archived ? (
              <button
                type="button"
                onClick={handleArchive}
                disabled={archiveBusy}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
              >
                {archiveBusy ? 'Archiving…' : 'Archive session'}
              </button>
            ) : null}
            <Link
              to="/"
              className="inline-flex items-center rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Home
            </Link>
          </div>
        </div>
      </header>

      {banner ? (
        <div className="mx-auto max-w-7xl px-4 pt-4">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">
            {banner}
          </p>
        </div>
      ) : null}

      {tasksError ? (
        <div className="mx-auto max-w-7xl px-4 pt-4">
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
            {tasksError}
          </p>
        </div>
      ) : null}

      <div className="mx-auto max-w-7xl px-4 py-6">
        {!archived ? (
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Add task to pool
            </button>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.data.status === col.status)
            return (
              <section
                key={col.status}
                className="flex min-h-[200px] flex-col rounded-2xl border border-zinc-200 bg-zinc-50/80 p-3"
              >
                <div className="mb-3 px-1">
                  <h2 className="text-sm font-semibold text-zinc-900">{col.label}</h2>
                  <p className="text-xs text-zinc-500">{col.hint}</p>
                  <p className="mt-1 text-xs font-medium text-zinc-600">{colTasks.length} tasks</p>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {colTasks.map((t) => (
                    <TaskCard key={t.id} task={t} onOpen={() => setSelectedTaskId(t.id)} />
                  ))}
                  {!colTasks.length ? (
                    <p className="px-1 py-6 text-center text-xs text-zinc-400">Nothing here</p>
                  ) : null}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        sessionId={sid}
        participant={participant}
      />

      {selectedTask ? (
        <TaskDetailModal
          sessionId={sid}
          task={selectedTask}
          participant={participant}
          sessionArchived={archived}
          onClose={() => setSelectedTaskId(null)}
        />
      ) : null}
    </div>
  )
}
