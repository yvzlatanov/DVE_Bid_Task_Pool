import { doc, onSnapshot } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getDb, getFirebaseStorage } from '../firebase/app'
import {
  addComment,
  addSubtaskComment,
  claimSubtask,
  claimTask,
  ConflictError,
  releaseSubtask,
  releaseTask,
  subscribeComments,
  subscribeSubtaskComments,
  updateSubtaskDetails,
  updateTaskDetails,
  uploadSubtaskAttachment,
  uploadTaskAttachment,
} from '../firebase/sessionApi'
import { normalizeEmail, uniqueAssigneesByEmail } from '../lib/participant'
import type { CommentDoc, Participant, TaskDoc, TaskLink, TaskPriority, TaskStatus } from '../lib/types'
import { PriorityBadge } from './PriorityBadge'
import { SubtaskBoard } from './SubtaskBoard'

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
const STATUSES: TaskStatus[] = ['pooled', 'in_progress', 'done', 'blocked']

type BaseProps = {
  sessionId: string
  participant: Participant
  sessionArchived: boolean
  onClose: () => void
  /** Stacked subtask modal uses a higher z-index. */
  stackZ?: string
  /** Viewers cannot edit; default true. */
  canEdit?: boolean
}

export type TaskDetailModalProps =
  | (BaseProps & { variant: 'task'; task: { id: string; data: TaskDoc } })
  | (BaseProps & {
      variant: 'subtask'
      parentTaskId: string
      parentTitle: string
      subtask: { id: string; data: TaskDoc }
    })

function formatTime(ts: { toDate?: () => Date } | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return ''
  try {
    return ts.toDate().toLocaleString()
  } catch {
    return ''
  }
}

function parseTagsInput(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

export function TaskDetailModal(props: TaskDetailModalProps) {
  const { sessionId, participant, sessionArchived, onClose, stackZ = 'z-50', canEdit = true } = props
  const variant = props.variant
  const db = useMemo(() => getDb(), [])
  const storage = useMemo(() => getFirebaseStorage(), [])

  const parentTaskId = variant === 'task' ? props.task.id : props.parentTaskId
  const itemId = variant === 'task' ? props.task.id : props.subtask.id

  const [liveSubtask, setLiveSubtask] = useState<TaskDoc | null>(null)

  useEffect(() => {
    if (variant !== 'subtask' || !db) return
    setLiveSubtask(null)
    const r = doc(db, 'sessions', sessionId, 'tasks', parentTaskId, 'subtasks', itemId)
    return onSnapshot(r, (snap) => {
      if (snap.exists()) setLiveSubtask(snap.data() as TaskDoc)
    })
  }, [variant, db, sessionId, parentTaskId, itemId])

  const itemData = variant === 'task' ? props.task.data : (liveSubtask ?? props.subtask.data)

  const [title, setTitle] = useState(itemData.title)
  const [description, setDescription] = useState(itemData.description)
  const [priority, setPriority] = useState<TaskPriority>(itemData.priority)
  const [status, setStatus] = useState<TaskStatus>(itemData.status)
  const [links, setLinks] = useState<TaskLink[]>(
    itemData.links?.length ? itemData.links : [{ url: '', label: '' }]
  )
  const [tagsInput, setTagsInput] = useState(() => (itemData.tags ?? []).join(', '))
  const [comments, setComments] = useState<{ id: string; data: CommentDoc }[]>([])
  const [commentText, setCommentText] = useState('')
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nestedSubtask, setNestedSubtask] = useState<{ id: string; data: TaskDoc } | null>(null)
  const [remoteConflict, setRemoteConflict] = useState(false)
  const baselineUpdatedMs = useRef(-1)
  const skipNextRemoteCheck = useRef(false)

  const isAssigned =
    (itemData.assigneeIds ?? []).includes(participant.id) ||
    (itemData.assignees ?? []).some(
      (a) => normalizeEmail(a.email) === normalizeEmail(participant.email)
    )
  const readOnly = sessionArchived || !canEdit

  useEffect(() => {
    const ms = itemData.updatedAt?.toMillis?.() ?? 0
    if (baselineUpdatedMs.current < 0) {
      baselineUpdatedMs.current = ms
      setRemoteConflict(false)
      return
    }
    if (skipNextRemoteCheck.current) {
      skipNextRemoteCheck.current = false
      baselineUpdatedMs.current = ms
      return
    }
    if (ms !== baselineUpdatedMs.current) {
      setRemoteConflict(true)
    }
  }, [itemData.updatedAt])

  useEffect(() => {
    baselineUpdatedMs.current = -1
    skipNextRemoteCheck.current = false
    setRemoteConflict(false)
  }, [itemId])

  useEffect(() => {
    setTitle(itemData.title)
    setDescription(itemData.description)
    setPriority(itemData.priority)
    setStatus(itemData.status)
    setLinks(itemData.links?.length ? itemData.links : [{ url: '', label: '' }])
    setTagsInput((itemData.tags ?? []).join(', '))
  }, [
    itemId,
    itemData.title,
    itemData.description,
    itemData.priority,
    itemData.status,
    itemData.links,
    itemData.tags,
  ])

  useEffect(() => {
    if (!db) return
    if (variant === 'task') {
      return subscribeComments(db, sessionId, itemId, setComments)
    }
    return subscribeSubtaskComments(db, sessionId, parentTaskId, itemId, setComments)
  }, [db, sessionId, variant, parentTaskId, itemId])

  const attachmentKey = itemData.attachments?.map((a) => a.storagePath).join('|') ?? ''

  useEffect(() => {
    let cancelled = false
    const storageClient = getFirebaseStorage()
    const paths = itemData.attachments ?? []
    if (!storageClient || paths.length === 0) {
      setAttachmentUrls({})
      return
    }
    void (async () => {
      const next: Record<string, string> = {}
      await Promise.all(
        paths.map(async (a) => {
          try {
            const url = await getDownloadURL(ref(storageClient, a.storagePath))
            next[a.storagePath] = url
          } catch {
            /* ignore broken refs */
          }
        })
      )
      if (!cancelled) setAttachmentUrls(next)
    })()
    return () => {
      cancelled = true
    }
  }, [attachmentKey, itemId])

  async function handleSave() {
    if (!db || readOnly) return
    setError(null)
    setBusy(true)
    setRemoteConflict(false)
    const patch = {
      title,
      description,
      priority,
      status,
      links: links
        .map((l) => ({ url: l.url.trim(), label: l.label?.trim() || undefined }))
        .filter((l) => l.url.length > 0),
      tags: parseTagsInput(tagsInput),
    }
    const expected = itemData.updatedAt
    try {
      if (variant === 'task') {
        await updateTaskDetails(db, sessionId, itemId, patch, participant, expected ?? null)
      } else {
        await updateSubtaskDetails(db, sessionId, parentTaskId, itemId, patch, participant, expected ?? null)
      }
      skipNextRemoteCheck.current = true
    } catch (err) {
      if (err instanceof ConflictError) {
        setError('Someone else saved changes first. Reload the form or save again to overwrite.')
        setRemoteConflict(true)
      } else {
        setError(err instanceof Error ? err.message : 'Could not save.')
      }
    } finally {
      setBusy(false)
    }
  }

  function reloadFormFromServer() {
    setTitle(itemData.title)
    setDescription(itemData.description)
    setPriority(itemData.priority)
    setStatus(itemData.status)
    setLinks(itemData.links?.length ? itemData.links : [{ url: '', label: '' }])
    setTagsInput((itemData.tags ?? []).join(', '))
    baselineUpdatedMs.current = itemData.updatedAt?.toMillis?.() ?? 0
    setRemoteConflict(false)
    setError(null)
  }

  function acceptMyVersionBaseline() {
    baselineUpdatedMs.current = itemData.updatedAt?.toMillis?.() ?? 0
    setRemoteConflict(false)
    setError(null)
  }

  async function handleClaim() {
    if (!db) return
    setError(null)
    setBusy(true)
    try {
      if (variant === 'task') {
        await claimTask(db, sessionId, itemId, participant)
      } else {
        await claimSubtask(db, sessionId, parentTaskId, itemId, participant)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not claim.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRelease() {
    if (!db) return
    setError(null)
    setBusy(true)
    try {
      if (variant === 'task') {
        await releaseTask(db, sessionId, itemId, participant)
      } else {
        await releaseSubtask(db, sessionId, parentTaskId, itemId, participant)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not release.')
    } finally {
      setBusy(false)
    }
  }

  async function handleComment(e: React.FormEvent) {
    e.preventDefault()
    if (!db || !commentText.trim()) return
    setError(null)
    setBusy(true)
    try {
      if (variant === 'task') {
        await addComment(db, sessionId, itemId, commentText, participant)
      } else {
        await addSubtaskComment(db, sessionId, parentTaskId, itemId, commentText, participant)
      }
      setCommentText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add comment.')
    } finally {
      setBusy(false)
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !db || !storage || readOnly) return
    setError(null)
    setBusy(true)
    try {
      if (variant === 'task') {
        await uploadTaskAttachment(storage, db, sessionId, itemId, file, participant)
      } else {
        await uploadSubtaskAttachment(storage, db, sessionId, parentTaskId, itemId, file, participant)
      }
      e.target.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const headerKind = variant === 'task' ? 'Task' : 'Subtask'
  const headerTitle = itemData.title
  const parentTitle = variant === 'subtask' ? props.parentTitle : null

  return (
    <>
      <div
        className={`fixed inset-0 ${stackZ} flex items-end justify-center bg-black/40 p-4 sm:items-center`}
      >
        <div
          className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-detail-title"
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-zinc-100 bg-white px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{headerKind}</p>
              {parentTitle ? (
                <p className="mt-0.5 truncate text-xs text-zinc-500">Under · {parentTitle}</p>
              ) : null}
              <h2 id="task-detail-title" className="truncate text-lg font-semibold tracking-tight">
                {headerTitle}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <PriorityBadge priority={itemData.priority} />
                <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                  {itemData.status.replace('_', ' ')}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            >
              Close
            </button>
          </div>

          <div className="space-y-6 px-5 py-5">
            {readOnly ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                {sessionArchived
                  ? 'This session is archived. Editing and new uploads are disabled.'
                  : 'You have view-only access. Editing and uploads are disabled.'}
              </p>
            ) : null}

            {remoteConflict && !readOnly ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <p className="font-medium">This item was updated elsewhere.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={reloadFormFromServer}
                    className="rounded-md bg-white px-3 py-1 text-xs font-medium ring-1 ring-amber-300 hover:bg-amber-100"
                  >
                    Reload from server
                  </button>
                  <button
                    type="button"
                    onClick={acceptMyVersionBaseline}
                    className="rounded-md bg-amber-900 px-3 py-1 text-xs font-medium text-white hover:bg-amber-800"
                  >
                    Keep my edits (save overwrites)
                  </button>
                </div>
              </div>
            ) : null}

            {!readOnly && itemData.status !== 'done' ? (
              <p className="text-sm leading-relaxed text-zinc-600">
                Several people can work on the same {variant === 'task' ? 'task' : 'subtask'}. You can join with
                &quot;Work on this {variant === 'task' ? 'task' : 'subtask'}&quot; even when it is already in progress;
                each person can release independently.
                {variant === 'subtask' ? (
                  <>
                    {' '}
                    Joining a subtask also adds you to the parent task so the hierarchy stays in sync.
                  </>
                ) : null}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {itemData.status !== 'done' && !isAssigned ? (
                <button
                  type="button"
                  disabled={busy || readOnly}
                  onClick={handleClaim}
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  Work on this {variant === 'task' ? 'task' : 'subtask'}
                </button>
              ) : null}
              {isAssigned ? (
                <button
                  type="button"
                  disabled={busy || readOnly}
                  onClick={handleRelease}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                >
                  Release my assignment
                </button>
              ) : null}
            </div>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-zinc-900">Details</h3>
              <div>
                <label htmlFor="detail-title" className="block text-xs font-medium text-zinc-600">
                  Title
                </label>
                <input
                  id="detail-title"
                  disabled={readOnly}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 disabled:bg-zinc-50"
                />
              </div>
              <div>
                <label htmlFor="detail-desc" className="block text-xs font-medium text-zinc-600">
                  Description
                </label>
                <textarea
                  id="detail-desc"
                  disabled={readOnly}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 disabled:bg-zinc-50"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="detail-priority" className="block text-xs font-medium text-zinc-600">
                    Priority
                  </label>
                  <select
                    id="detail-priority"
                    disabled={readOnly}
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 disabled:bg-zinc-50"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="detail-status" className="block text-xs font-medium text-zinc-600">
                    Status
                  </label>
                  <select
                    id="detail-status"
                    disabled={readOnly}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as TaskStatus)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 disabled:bg-zinc-50"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="detail-tags" className="block text-xs font-medium text-zinc-600">
                  Tags (comma-separated)
                </label>
                <input
                  id="detail-tags"
                  disabled={readOnly}
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="e.g. electrical, RFQ, urgent"
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 disabled:bg-zinc-50"
                />
              </div>
              {!readOnly ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSave}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                >
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              ) : null}
            </section>

            <section>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-900">Links</h3>
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() => setLinks((prev) => [...prev, { url: '', label: '' }])}
                    className="text-sm font-medium text-zinc-700 hover:underline"
                  >
                    Add link
                  </button>
                ) : null}
              </div>
              <div className="mt-2 space-y-2">
                {links.map((link, i) => (
                  <div key={i} className="flex flex-col gap-2 sm:flex-row">
                    <input
                      disabled={readOnly}
                      placeholder="URL"
                      value={link.url}
                      onChange={(e) => {
                        const next = [...links]
                        next[i] = { ...next[i], url: e.target.value }
                        setLinks(next)
                      }}
                      className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 disabled:bg-zinc-50"
                    />
                    <input
                      disabled={readOnly}
                      placeholder="Label (optional)"
                      value={link.label ?? ''}
                      onChange={(e) => {
                        const next = [...links]
                        next[i] = { ...next[i], label: e.target.value }
                        setLinks(next)
                      }}
                      className="sm:w-40 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 disabled:bg-zinc-50"
                    />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-zinc-900">Attachments</h3>
              {!readOnly ? (
                <label className="mt-2 inline-flex cursor-pointer rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50">
                  <input type="file" className="sr-only" onChange={handleFile} disabled={busy} />
                  Upload file
                </label>
              ) : null}
              <ul className="mt-3 space-y-2">
                {(itemData.attachments ?? []).map((a) => (
                  <li key={a.storagePath} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-zinc-800">{a.fileName}</span>
                    {attachmentUrls[a.storagePath] ? (
                      <a
                        href={attachmentUrls[a.storagePath]}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 font-medium text-zinc-700 underline-offset-4 hover:underline"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="shrink-0 text-xs text-zinc-500">Preparing link…</span>
                    )}
                  </li>
                ))}
                {!(itemData.attachments ?? []).length ? (
                  <li className="text-sm text-zinc-500">No attachments yet.</li>
                ) : null}
              </ul>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-zinc-900">People on this {variant === 'task' ? 'task' : 'subtask'}</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {uniqueAssigneesByEmail(itemData.assignees ?? []).map((a) => (
                  <li
                    key={a.id}
                    className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-800"
                  >
                    {a.displayName}
                  </li>
                ))}
                {!uniqueAssigneesByEmail(itemData.assignees ?? []).length ? (
                  <li className="text-sm text-zinc-500">No one has claimed this yet.</li>
                ) : null}
              </ul>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-zinc-900">Comments</h3>
              <ul className="mt-3 space-y-3 border-t border-zinc-100 pt-3">
                {comments.map((c) => (
                  <li key={c.id} className="rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                    <p className="font-medium text-zinc-900">{c.data.createdBy.displayName}</p>
                    <p className="mt-1 whitespace-pre-wrap text-zinc-700">{c.data.text}</p>
                    <p className="mt-1 text-xs text-zinc-500">{formatTime(c.data.createdAt)}</p>
                  </li>
                ))}
                {!comments.length ? <li className="text-sm text-zinc-500">No comments yet.</li> : null}
              </ul>
              {!readOnly ? (
                <form onSubmit={handleComment} className="mt-4 space-y-2">
                  <label htmlFor="new-comment" className="sr-only">
                    New comment
                  </label>
                  <textarea
                    id="new-comment"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    rows={3}
                    placeholder="Write a comment…"
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400"
                  />
                  <button
                    type="submit"
                    disabled={busy || !commentText.trim()}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Post comment
                  </button>
                </form>
              ) : null}
            </section>

            {variant === 'task' ? (
              <SubtaskBoard
                sessionId={sessionId}
                parentTaskId={props.task.id}
                sessionArchived={sessionArchived}
                participant={participant}
                canEdit={canEdit}
                onOpenSubtask={setNestedSubtask}
              />
            ) : null}

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        </div>
      </div>

      {variant === 'task' && nestedSubtask ? (
        <TaskDetailModal
          key={nestedSubtask.id}
          variant="subtask"
          sessionId={sessionId}
          parentTaskId={props.task.id}
          parentTitle={props.task.data.title}
          subtask={nestedSubtask}
          participant={participant}
          sessionArchived={sessionArchived}
          canEdit={canEdit}
          onClose={() => setNestedSubtask(null)}
          stackZ="z-[60]"
        />
      ) : null}
    </>
  )
}
