import type { Timestamp } from 'firebase/firestore'
import { normalizeEmail, uniqueAssigneesByEmail } from '../lib/participant'
import type { SessionParticipantDoc, TaskDoc } from '../lib/types'

const STALE_MS = 4 * 60 * 1000

function tsMs(ts: Timestamp | undefined): number {
  if (!ts || typeof ts.toMillis !== 'function') return 0
  try {
    return ts.toMillis()
  } catch {
    return 0
  }
}

/** Use lastSeen when resolved; otherwise joinedAt. Unresolved server timestamps (0) count as fresh so new joiners appear in Available. */
function effectivePresenceMs(p: SessionParticipantDoc): number {
  const ls = tsMs(p.lastSeen)
  const j = tsMs(p.joinedAt)
  return Math.max(ls, j)
}

function isParticipantStale(p: SessionParticipantDoc): boolean {
  const eff = effectivePresenceMs(p)
  if (!eff) return false
  return Date.now() - eff > STALE_MS
}

type TaskRow = { id: string; data: TaskDoc }

type Props = {
  open: boolean
  onClose: () => void
  participants: { id: string; data: SessionParticipantDoc }[]
  tasks: TaskRow[]
  /** Subtasks keyed by parent task id (used for “busy” / availability). */
  subtasksByTaskId?: Record<string, TaskRow[]>
}

function formatSeen(p: SessionParticipantDoc): string {
  const ms = effectivePresenceMs(p)
  if (!ms) return 'Just now'
  try {
    return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return 'Unknown'
  }
}

function dedupePresenceByEmail(list: { id: string; data: SessionParticipantDoc }[]) {
  const map = new Map<string, { id: string; data: SessionParticipantDoc }>()
  for (const p of list) {
    const k = normalizeEmail(p.data.email)
    const cur = map.get(k)
    if (!cur || effectivePresenceMs(p.data) > effectivePresenceMs(cur.data)) {
      map.set(k, p)
    }
  }
  return [...map.values()]
}

type BusyRef = { taskId: string; title: string }

export function PeoplePanel({ open, onClose, participants, tasks, subtasksByTaskId }: Props) {
  const activeTasks = tasks.filter((t) => t.data.status !== 'done')

  const busyByEmail = new Map<string, BusyRef[]>()
  for (const t of activeTasks) {
    for (const a of uniqueAssigneesByEmail(t.data.assignees ?? [])) {
      const k = normalizeEmail(a.email)
      const list = busyByEmail.get(k) ?? []
      list.push({ taskId: t.id, title: t.data.title })
      busyByEmail.set(k, list)
    }
    const subs = subtasksByTaskId?.[t.id] ?? []
    for (const st of subs) {
      if (st.data.status === 'done') continue
      for (const a of uniqueAssigneesByEmail(st.data.assignees ?? [])) {
        const k = normalizeEmail(a.email)
        const list = busyByEmail.get(k) ?? []
        list.push({
          taskId: t.id,
          title: `${t.data.title} › ${st.data.title}`,
        })
        busyByEmail.set(k, list)
      }
    }
  }

  const sorted = dedupePresenceByEmail([...participants]).sort((a, b) =>
    a.data.displayName.localeCompare(b.data.displayName, undefined, { sensitivity: 'base' })
  )

  const available = sorted.filter(
    (p) => !isParticipantStale(p.data) && !busyByEmail.has(normalizeEmail(p.data.email))
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" role="presentation">
      <button
        type="button"
        className="h-full min-w-0 flex-1 cursor-default"
        aria-label="Close panel"
        onClick={onClose}
      />
      <aside
        className="flex h-full w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-xl"
        role="dialog"
        aria-labelledby="people-panel-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <h2 id="people-panel-title" className="text-base font-semibold text-zinc-900">
            People in this session
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 text-sm">
          <section className="mb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Available (not on a task)
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              Active in the last few minutes and not assigned to an open task. Others can still join the same task as
              teammates.
            </p>
            <ul className="mt-3 space-y-2">
              {available.map((p) => (
                <li
                  key={p.id}
                  className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-zinc-900"
                >
                  <span className="font-medium">{p.data.displayName}</span>
                  <span className="mt-0.5 block text-xs text-zinc-600">{p.data.email}</span>
                </li>
              ))}
              {!available.length ? (
                <li className="text-xs text-zinc-500">No one in this bucket right now.</li>
              ) : null}
            </ul>
          </section>

          <section className="mb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">On tasks</h3>
            <p className="mt-1 text-xs text-zinc-500">Multiple people can share the same task.</p>
            <ul className="mt-3 space-y-4">
              {activeTasks
                .filter((t) => {
                  const onTask = uniqueAssigneesByEmail(t.data.assignees ?? []).length > 0
                  const subBusy = (subtasksByTaskId?.[t.id] ?? []).some(
                    (s) =>
                      s.data.status !== 'done' &&
                      uniqueAssigneesByEmail(s.data.assignees ?? []).length > 0
                  )
                  return onTask || subBusy
                })
                .map((t) => (
                  <li key={t.id} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <p className="font-medium text-zinc-900">{t.data.title}</p>
                    <p className="text-xs text-zinc-500 capitalize">{t.data.status.replace('_', ' ')}</p>
                    <ul className="mt-2 space-y-1">
                      {uniqueAssigneesByEmail(t.data.assignees ?? []).map((a) => (
                        <li key={a.id} className="text-xs text-zinc-700">
                          {a.displayName}
                        </li>
                      ))}
                    </ul>
                    {(subtasksByTaskId?.[t.id] ?? [])
                      .filter(
                        (s) =>
                          s.data.status !== 'done' &&
                          uniqueAssigneesByEmail(s.data.assignees ?? []).length > 0
                      )
                      .map((s) => (
                        <div
                          key={s.id}
                          className="mt-3 border-l-2 border-zinc-300 pl-3 text-xs text-zinc-700"
                        >
                          <p className="font-medium text-zinc-800">{s.data.title}</p>
                          <p className="text-zinc-500 capitalize">{s.data.status.replace('_', ' ')}</p>
                          <ul className="mt-1 space-y-0.5">
                            {uniqueAssigneesByEmail(s.data.assignees ?? []).map((a) => (
                              <li key={a.id}>{a.displayName}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                  </li>
                ))}
              {!activeTasks.some((t) => {
                const onTask = uniqueAssigneesByEmail(t.data.assignees ?? []).length > 0
                const subBusy = (subtasksByTaskId?.[t.id] ?? []).some(
                  (s) =>
                    s.data.status !== 'done' &&
                    uniqueAssigneesByEmail(s.data.assignees ?? []).length > 0
                )
                return onTask || subBusy
              }) ? (
                <li className="text-xs text-zinc-500">No assignments on open tasks or subtasks yet.</li>
              ) : null}
            </ul>
          </section>

          <section className="mb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Everyone here</h3>
            <ul className="mt-2 space-y-2">
              {sorted.map((p) => {
                const stale = isParticipantStale(p.data)
                const busy = busyByEmail.get(normalizeEmail(p.data.email))
                return (
                  <li
                    key={p.id}
                    className={`rounded-lg border px-3 py-2 ${
                      stale ? 'border-zinc-100 bg-zinc-50 text-zinc-500' : 'border-zinc-200 bg-white text-zinc-900'
                    }`}
                  >
                    <div className="font-medium">{p.data.displayName}</div>
                    <div className="text-xs text-zinc-600">{p.data.email}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {stale ? 'Away or inactive · last active ' : 'Last active '}
                      {formatSeen(p.data)}
                    </div>
                    {busy?.length ? (
                      <div className="mt-1 text-xs text-zinc-600">
                        Tasks: {busy.map((b) => b.title).join(', ')}
                      </div>
                    ) : null}
                  </li>
                )
              })}
              {!sorted.length ? (
                <li className="text-xs text-zinc-500">No one else has checked in yet. Names appear as people use the board.</li>
              ) : null}
            </ul>
          </section>

        </div>
      </aside>
    </div>
  )
}
