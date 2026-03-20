import type { TaskPriority } from '../lib/types'

const styles: Record<TaskPriority, string> = {
  low: 'bg-zinc-100 text-zinc-700 ring-zinc-200',
  medium: 'bg-amber-50 text-amber-900 ring-amber-200',
  high: 'bg-orange-50 text-orange-900 ring-orange-200',
  urgent: 'bg-red-50 text-red-900 ring-red-200',
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[priority]}`}
    >
      {priority.replace('_', ' ')}
    </span>
  )
}
