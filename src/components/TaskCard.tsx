import type { TaskDoc } from '../lib/types'
import { PriorityBadge } from './PriorityBadge'

type Props = {
  task: { id: string; data: TaskDoc }
  onOpen: () => void
}

export function TaskCard({ task, onOpen }: Props) {
  const { data } = task
  const names = (data.assignees ?? []).map((a) => a.displayName).join(', ')
  const linkCount = data.links?.length ?? 0
  const attCount = data.attachments?.length ?? 0

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
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
        {names ? <span>Working: {names}</span> : <span>In the pool</span>}
        {linkCount > 0 ? <span>{linkCount} link{linkCount === 1 ? '' : 's'}</span> : null}
        {attCount > 0 ? <span>{attCount} file{attCount === 1 ? '' : 's'}</span> : null}
      </div>
    </button>
  )
}
