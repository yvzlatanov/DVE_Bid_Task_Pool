import { uniqueAssigneesByEmail } from '../lib/participant'
import type { TaskDoc } from '../lib/types'
import { PriorityBadge } from './PriorityBadge'

type Props = {
  task: { id: string; data: TaskDoc }
  onOpen: () => void
}

export function TaskCard({ task, onOpen }: Props) {
  const { data } = task
  const assignees = uniqueAssigneesByEmail(data.assignees ?? [])
  const names = assignees.map((a) => a.displayName).join(', ')
  const assigneeCount = assignees.length
  const linkCount = data.links?.length ?? 0
  const attCount = data.attachments?.length ?? 0
  const tags = data.tags ?? []

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug text-zinc-900">{data.title}</h3>
        <PriorityBadge priority={data.priority} />
      </div>
      {data.description ? (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-600">{data.description}</p>
      ) : null}
      {tags.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.slice(0, 5).map((t, i) => (
            <span
              key={`${t}-${i}`}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-700"
            >
              {t}
            </span>
          ))}
          {tags.length > 5 ? (
            <span className="text-[10px] text-zinc-500">+{tags.length - 5}</span>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
        {names ? (
          <span>
            {assigneeCount > 1 ? `${assigneeCount} people: ${names}` : `Working: ${names}`}
          </span>
        ) : (
          <span>In the pool</span>
        )}
        {linkCount > 0 ? <span>{linkCount} link{linkCount === 1 ? '' : 's'}</span> : null}
        {attCount > 0 ? <span>{attCount} file{attCount === 1 ? '' : 's'}</span> : null}
      </div>
    </button>
  )
}
