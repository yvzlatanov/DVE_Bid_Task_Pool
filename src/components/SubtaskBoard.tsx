import { useEffect, useMemo, useState } from 'react'
import { getDb } from '../firebase/app'
import { subscribeSubtasks } from '../firebase/sessionApi'
import type { Participant, TaskDoc, TaskStatus } from '../lib/types'
import { CreateSubtaskModal } from './CreateSubtaskModal'
import { TaskCard } from './TaskCard'

const COLUMNS: { status: TaskStatus; label: string; hint: string }[] = [
  { status: 'pooled', label: 'Pool', hint: 'Unclaimed' },
  { status: 'in_progress', label: 'In progress', hint: 'Active' },
  { status: 'blocked', label: 'Blocked', hint: 'Stuck' },
  { status: 'done', label: 'Done', hint: 'Complete' },
]

type Props = {
  sessionId: string
  parentTaskId: string
  sessionArchived: boolean
  participant: Participant
  onOpenSubtask: (subtask: { id: string; data: TaskDoc }) => void
}

export function SubtaskBoard({
  sessionId,
  parentTaskId,
  sessionArchived,
  participant,
  onOpenSubtask,
}: Props) {
  const db = useMemo(() => getDb(), [])
  const [subtasks, setSubtasks] = useState<{ id: string; data: TaskDoc }[]>([])
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    if (!db) return
    return subscribeSubtasks(db, sessionId, parentTaskId, setSubtasks)
  }, [db, sessionId, parentTaskId])

  return (
    <section className="border-t border-zinc-100 pt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Subtasks</h3>
          <p className="text-xs text-zinc-500">
            Same workflow as the main board — pool through done, with full detail on each card.
          </p>
        </div>
        {!sessionArchived ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800"
          >
            Add subtask
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const colItems = subtasks.filter((s) => s.data.status === col.status)
          return (
            <div
              key={col.status}
              className="flex min-h-[140px] flex-col rounded-xl border border-zinc-200 bg-zinc-50/80 p-2"
            >
              <div className="mb-2 px-1">
                <h4 className="text-xs font-semibold text-zinc-900">{col.label}</h4>
                <p className="text-[10px] text-zinc-500">{col.hint}</p>
                <p className="mt-0.5 text-[10px] font-medium text-zinc-600">{colItems.length}</p>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {colItems.map((s) => (
                  <TaskCard key={s.id} task={s} onOpen={() => onOpenSubtask(s)} />
                ))}
                {!colItems.length ? (
                  <p className="px-1 py-4 text-center text-[10px] text-zinc-400">Nothing here</p>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <CreateSubtaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        sessionId={sessionId}
        taskId={parentTaskId}
        participant={participant}
      />
    </section>
  )
}
