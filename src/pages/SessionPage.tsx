import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { CreateTaskModal } from '../components/CreateTaskModal'
import { PeoplePanel } from '../components/PeoplePanel'
import { SessionInviteSection } from '../components/SessionInviteSection'
import { TaskCard } from '../components/TaskCard'
import { TaskDetailModal } from '../components/TaskDetailModal'
import { getDb } from '../firebase/app'
import {
  archiveSession,
  joinSessionIfAllowed,
  subscribeMember,
  subscribeParticipants,
  subscribeSession,
  subscribeSubtasks,
  subscribeTasks,
  updateSessionAccessSettings,
  upsertSessionPresence,
} from '../firebase/sessionApi'
import { recordParticipatedSession } from '../lib/mySessions'
import { normalizeEmail } from '../lib/participant'
import type {
  MemberRole,
  Participant,
  SessionAccessMode,
  SessionDoc,
  SessionMemberDoc,
  SessionParticipantDoc,
  TaskDoc,
  TaskPriority,
  TaskStatus,
} from '../lib/types'

const COLUMNS: { status: TaskStatus; label: string; hint: string }[] = [
  { status: 'pooled', label: 'Pool', hint: 'Unclaimed work' },
  { status: 'in_progress', label: 'In progress', hint: 'One or more people' },
  { status: 'blocked', label: 'Blocked', hint: 'Needs attention' },
  { status: 'done', label: 'Done', hint: 'Completed' },
]

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { participant } = useAuth()
  const db = useMemo(() => getDb(), [])

  const [session, setSession] = useState<SessionDoc | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [member, setMember] = useState<SessionMemberDoc | null>(null)
  const [memberReady, setMemberReady] = useState(false)
  const [tasks, setTasks] = useState<{ id: string; data: TaskDoc }[]>([])
  const [tasksError, setTasksError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filterPriorities, setFilterPriorities] = useState<TaskPriority[]>([])
  const [filterStatuses, setFilterStatuses] = useState<TaskStatus[]>([])
  const [filterAssigneeEmail, setFilterAssigneeEmail] = useState('')
  const [filterUpdatedFrom, setFilterUpdatedFrom] = useState('')
  const [filterUpdatedTo, setFilterUpdatedTo] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [participants, setParticipants] = useState<{ id: string; data: SessionParticipantDoc }[]>([])
  const [subtasksByTaskId, setSubtasksByTaskId] = useState<
    Record<string, { id: string; data: TaskDoc }[]>
  >({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [accessDraft, setAccessDraft] = useState<SessionAccessMode>('link_join')
  const [linkExpiryDraft, setLinkExpiryDraft] = useState('')
  const [settingsBusy, setSettingsBusy] = useState(false)

  const sid = sessionId ?? ''
  const p = participant as Participant

  const taskIdsKey = useMemo(() => {
    const ids = [...new Set(tasks.map((t) => t.id))].sort()
    return ids.join('|')
  }, [tasks])

  useEffect(() => {
    if (!db || !sid || !participant) return
    setJoinError(null)
    void joinSessionIfAllowed(db, sid, participant).catch((err) => {
      setJoinError(err instanceof Error ? err.message : 'Could not join session')
    })
  }, [db, sid, participant])

  useEffect(() => {
    if (!db || !sid || !participant) return
    setMemberReady(false)
    return subscribeMember(
      db,
      sid,
      participant.id,
      (m) => {
        setMember(m)
        setMemberReady(true)
      },
      () => setMemberReady(true)
    )
  }, [db, sid, participant])

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
        if (data) {
          setAccessDraft(data.accessMode ?? 'link_join')
          if (data.linkExpiresAt && typeof data.linkExpiresAt.toDate === 'function') {
            const d = data.linkExpiresAt.toDate()
            const pad = (n: number) => String(n).padStart(2, '0')
            setLinkExpiryDraft(
              `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
            )
          } else {
            setLinkExpiryDraft('')
          }
        }
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

  useEffect(() => {
    if (!db || !sid) return
    return subscribeParticipants(db, sid, setParticipants)
  }, [db, sid])

  useEffect(() => {
    if (!db || !sid) return
    const ids = [...new Set(tasks.map((t) => t.id))].sort()
    setSubtasksByTaskId({})
    if (ids.length === 0) return
    const unsubs = ids.map((taskId) =>
      subscribeSubtasks(db, sid, taskId, (list) => {
        setSubtasksByTaskId((prev) => ({ ...prev, [taskId]: list }))
      })
    )
    return () => unsubs.forEach((u) => u())
  }, [db, sid, taskIdsKey])

  const subtasksForPeople = useMemo(() => {
    const out: Record<string, { id: string; data: TaskDoc }[]> = {}
    for (const t of tasks) {
      const list = subtasksByTaskId[t.id]
      if (list?.length) out[t.id] = list
    }
    return out
  }, [tasks, subtasksByTaskId])

  useEffect(() => {
    if (!db || !sid || !participant) return
    void upsertSessionPresence(db, sid, participant)
  }, [db, sid, participant])

  useEffect(() => {
    if (!db || !sid || !participant || !session) return
    const t = window.setInterval(() => {
      void upsertSessionPresence(db, sid, participant)
    }, 20_000)
    return () => window.clearInterval(t)
  }, [db, sid, participant, session])

  useEffect(() => {
    if (!db || !sid || !participant) return
    function onVisible() {
      if (document.visibilityState === 'visible' && db && sid && participant) {
        void upsertSessionPresence(db, sid, participant)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [db, sid, participant])

  useEffect(() => {
    if (!session || !participant || !sid) return
    recordParticipatedSession(participant, sid, session.title)
  }, [session, participant, sid])

  const memberRole: MemberRole | null = member?.role ?? null
  const isAdmin = memberRole === 'admin'
  const isEditor = memberRole === 'admin' || memberRole === 'editor'
  const isViewer = memberRole === 'viewer'

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    const pr = filterPriorities
    const st = filterStatuses
    const ae = filterAssigneeEmail.trim().toLowerCase()
    const fromMs = filterUpdatedFrom ? new Date(filterUpdatedFrom).getTime() : null
    const toMs = filterUpdatedTo ? new Date(filterUpdatedTo).getTime() : null

    return tasks.filter(({ data }) => {
      if (q) {
        const t = `${data.title}\n${data.description}`.toLowerCase()
        if (!t.includes(q)) return false
      }
      if (pr.length && !pr.includes(data.priority)) return false
      if (st.length && !st.includes(data.status)) return false
      if (ae) {
        const assignees = data.assignees ?? []
        if (!assignees.some((a) => normalizeEmail(a.email).includes(ae) || a.displayName.toLowerCase().includes(ae))) {
          return false
        }
      }
      if (fromMs !== null && Number.isFinite(fromMs)) {
        const u = data.updatedAt?.toMillis?.() ?? 0
        if (u < fromMs) return false
      }
      if (toMs !== null && Number.isFinite(toMs)) {
        const u = data.updatedAt?.toMillis?.() ?? 0
        if (u > toMs + 60_000) return false
      }
      return true
    })
  }, [tasks, search, filterPriorities, filterStatuses, filterAssigneeEmail, filterUpdatedFrom, filterUpdatedTo])

  const togglePriority = (x: TaskPriority) => {
    setFilterPriorities((prev) => (prev.includes(x) ? prev.filter((p) => p !== x) : [...prev, x]))
  }
  const toggleStatus = (x: TaskStatus) => {
    setFilterStatuses((prev) => (prev.includes(x) ? prev.filter((s) => s !== x) : [...prev, x]))
  }

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

  const handleArchive = useCallback(async () => {
    if (!db || !sid || !participant || !isAdmin) return
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
  }, [db, sid, participant, isAdmin])

  const saveSettings = useCallback(async () => {
    if (!db || !sid || !participant || !isAdmin) return
    setSettingsBusy(true)
    try {
      let linkExpiresAt: Date | null = null
      if (accessDraft === 'link_join' && linkExpiryDraft.trim()) {
        const d = new Date(linkExpiryDraft)
        if (!Number.isNaN(d.getTime())) linkExpiresAt = d
      }
      if (accessDraft === 'invite_only') linkExpiresAt = null
      await updateSessionAccessSettings(db, sid, { accessMode: accessDraft, linkExpiresAt }, participant)
      setBanner('Session settings saved.')
      setTimeout(() => setBanner(null), 3200)
      setSettingsOpen(false)
    } catch {
      setBanner('Could not save settings.')
    } finally {
      setSettingsBusy(false)
    }
  }, [db, sid, participant, isAdmin, accessDraft, linkExpiryDraft])

  if (!db || !sid) {
    return (
      <div className="min-h-screen bg-zinc-50 p-8 text-center text-sm text-zinc-600">
        Invalid session link.
      </div>
    )
  }

  if (!sessionReady || !memberReady) {
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

  if (!member) {
    return (
      <div className="min-h-screen bg-zinc-50 px-4 py-12 text-center text-sm text-zinc-800">
        <p className="font-medium">You don’t have access to this session yet.</p>
        <p className="mt-2 text-zinc-600">{joinError ?? 'If the session is invite-only, open a valid invite link.'}</p>
        <Link to="/" className="mt-6 inline-block font-medium text-zinc-900 underline">
          Home
        </Link>
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
            <p className="mt-1 text-xs text-zinc-500">
              You are {memberRole}
              {session.accessMode === 'invite_only' ? ' · Invite-only' : ' · Link join'}
            </p>
            {archived ? (
              <p className="mt-2 text-sm font-medium text-amber-800">Archived — read only</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPeopleOpen(true)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              People
            </button>
            <button
              type="button"
              onClick={copyLink}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Copy link
            </button>
            {!archived && isAdmin ? (
              <button
                type="button"
                onClick={() => setSettingsOpen((o) => !o)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                Session settings
              </button>
            ) : null}
            {!archived && isAdmin ? (
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

      {settingsOpen && isAdmin ? (
        <div className="mx-auto max-w-7xl border-b border-zinc-200 bg-white px-4 py-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Access</h3>
              <select
                value={accessDraft}
                onChange={(e) => setAccessDraft(e.target.value as SessionAccessMode)}
                className="w-full max-w-md rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="link_join">Link join (signed-in users with link)</option>
                <option value="invite_only">Invite only</option>
              </select>
              {accessDraft === 'link_join' ? (
                <div>
                  <label className="text-xs font-medium text-zinc-600">Link expiry (optional)</label>
                  <input
                    type="datetime-local"
                    value={linkExpiryDraft}
                    onChange={(e) => setLinkExpiryDraft(e.target.value)}
                    className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                  />
                </div>
              ) : null}
              <button
                type="button"
                disabled={settingsBusy}
                onClick={() => void saveSettings()}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {settingsBusy ? 'Saving…' : 'Save settings'}
              </button>
            </div>
            <SessionInviteSection sessionId={sid} />
          </div>
        </div>
      ) : null}

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
        <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Find tasks</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <input
              type="search"
              placeholder="Search title or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400"
            />
            <input
              type="text"
              placeholder="Assignee name or email…"
              value={filterAssigneeEmail}
              onChange={(e) => setFilterAssigneeEmail(e.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400"
            />
            <input
              type="datetime-local"
              value={filterUpdatedFrom}
              onChange={(e) => setFilterUpdatedFrom(e.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={filterUpdatedTo}
              onChange={(e) => setFilterUpdatedTo(e.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-xs font-medium text-zinc-500">Priority:</span>
            {PRIORITIES.map((pr) => (
              <button
                key={pr}
                type="button"
                onClick={() => togglePriority(pr)}
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  filterPriorities.includes(pr)
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                }`}
              >
                {pr}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="text-xs font-medium text-zinc-500">Status:</span>
            {COLUMNS.map((c) => (
              <button
                key={c.status}
                type="button"
                onClick={() => toggleStatus(c.status)}
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  filterStatuses.includes(c.status)
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Showing {filteredTasks.length} of {tasks.length} tasks
          </p>
        </div>

        {!archived && isEditor ? (
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
        {isViewer && !archived ? (
          <p className="mb-6 text-sm text-zinc-600">You have view-only access in this session.</p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.data.status === col.status)
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
        participant={p}
      />

      {selectedTask ? (
        <TaskDetailModal
          variant="task"
          sessionId={sid}
          task={selectedTask}
          participant={p}
          sessionArchived={archived}
          canEdit={isEditor}
          onClose={() => setSelectedTaskId(null)}
        />
      ) : null}

      <PeoplePanel
        open={peopleOpen}
        onClose={() => setPeopleOpen(false)}
        participants={participants}
        tasks={tasks}
        subtasksByTaskId={subtasksForPeople}
      />
    </div>
  )
}
