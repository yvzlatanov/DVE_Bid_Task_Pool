import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage'
import type {
  AuditEventType,
  CommentDoc,
  Participant,
  SessionDoc,
  TaskDoc,
  TaskLink,
  TaskPriority,
  TaskStatus,
} from '../lib/types'

function auditCollection(db: Firestore, sessionId: string) {
  return collection(db, 'sessions', sessionId, 'audit')
}

function tasksCollection(db: Firestore, sessionId: string) {
  return collection(db, 'sessions', sessionId, 'tasks')
}

function commentsCollection(db: Firestore, sessionId: string, taskId: string) {
  return collection(db, 'sessions', sessionId, 'tasks', taskId, 'comments')
}

export async function appendAudit(
  db: Firestore,
  sessionId: string,
  type: AuditEventType,
  actor: Participant,
  payload: Record<string, unknown>
) {
  await addDoc(auditCollection(db, sessionId), {
    type,
    at: serverTimestamp(),
    actor,
    payload,
  })
}

export async function createSession(
  db: Firestore,
  sessionId: string,
  input: { title: string; bidLabel: string },
  actor: Participant
) {
  await setDoc(doc(db, 'sessions', sessionId), {
    title: input.title.trim(),
    bidLabel: (input.bidLabel ?? '').trim(),
    status: 'active',
    createdAt: serverTimestamp(),
    createdBy: actor,
  })
  await appendAudit(db, sessionId, 'session_created', actor, {
    title: input.title.trim(),
    bidLabel: (input.bidLabel ?? '').trim(),
  })
}

export async function archiveSession(
  db: Firestore,
  sessionId: string,
  actor: Participant
) {
  await updateDoc(doc(db, 'sessions', sessionId), {
    status: 'archived',
  })
  await appendAudit(db, sessionId, 'session_archived', actor, {})
}

export function subscribeSession(
  db: Firestore,
  sessionId: string,
  onData: (data: SessionDoc | null) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'sessions', sessionId),
    (snap) => {
      if (!snap.exists()) {
        onData(null)
        return
      }
      onData(snap.data() as SessionDoc)
    },
    (err) => onError?.(err)
  )
}

export function subscribeTasks(
  db: Firestore,
  sessionId: string,
  onData: (tasks: { id: string; data: TaskDoc }[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const q = query(tasksCollection(db, sessionId), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, data: d.data() as TaskDoc }))
      onData(list)
    },
    (err) => onError?.(err)
  )
}

export function subscribeComments(
  db: Firestore,
  sessionId: string,
  taskId: string,
  onData: (comments: { id: string; data: CommentDoc }[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const q = query(commentsCollection(db, sessionId, taskId), orderBy('createdAt', 'asc'))
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, data: d.data() as CommentDoc }))
      onData(list)
    },
    (err) => onError?.(err)
  )
}

export async function createTask(
  db: Firestore,
  sessionId: string,
  input: {
    title: string
    description: string
    priority: TaskPriority
    links: TaskLink[]
  },
  actor: Participant
) {
  const taskRef = doc(tasksCollection(db, sessionId))
  const payload = {
    title: input.title.trim(),
    description: input.description.trim(),
    priority: input.priority,
    status: 'pooled' as TaskStatus,
    assigneeIds: [] as string[],
    assignees: [] as TaskDoc['assignees'],
    links: input.links.filter((l) => l.url.trim()),
    attachments: [] as TaskDoc['attachments'],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: actor,
  }
  await setDoc(taskRef, payload)
  await appendAudit(db, sessionId, 'task_created', actor, {
    taskId: taskRef.id,
    title: payload.title,
    priority: payload.priority,
  })
  return taskRef.id
}

export async function updateTaskDetails(
  db: Firestore,
  sessionId: string,
  taskId: string,
  patch: Partial<{
    title: string
    description: string
    priority: TaskPriority
    status: TaskStatus
    links: TaskLink[]
  }>,
  actor: Participant
) {
  const taskRef = doc(db, 'sessions', sessionId, 'tasks', taskId)
  const clean: Record<string, unknown> = { updatedAt: serverTimestamp() }
  if (patch.title !== undefined) clean.title = patch.title.trim()
  if (patch.description !== undefined) clean.description = patch.description.trim()
  if (patch.priority !== undefined) clean.priority = patch.priority
  if (patch.status !== undefined) clean.status = patch.status
  if (patch.links !== undefined) clean.links = patch.links.filter((l) => l.url.trim())
  await updateDoc(taskRef, clean)
  await appendAudit(db, sessionId, 'task_updated', actor, { taskId, patch })
}

export async function claimTask(
  db: Firestore,
  sessionId: string,
  taskId: string,
  actor: Participant
) {
  const taskRef = doc(db, 'sessions', sessionId, 'tasks', taskId)
  const snap = await getDoc(taskRef)
  if (!snap.exists()) throw new Error('Task not found')
  const data = snap.data() as TaskDoc
  if (data.status === 'done') throw new Error('Cannot claim a completed task')
  const mini = { id: actor.id, displayName: actor.displayName, email: actor.email }
  await updateDoc(taskRef, {
    assigneeIds: arrayUnion(actor.id),
    assignees: arrayUnion(mini),
    status: 'in_progress',
    updatedAt: serverTimestamp(),
  })
  await appendAudit(db, sessionId, 'task_claimed', actor, { taskId })
}

export async function releaseTask(
  db: Firestore,
  sessionId: string,
  taskId: string,
  actor: Participant
) {
  const taskRef = doc(db, 'sessions', sessionId, 'tasks', taskId)
  const snap = await getDoc(taskRef)
  if (!snap.exists()) throw new Error('Task not found')
  const data = snap.data() as TaskDoc
  const assigneeIds = (data.assigneeIds ?? []).filter((id) => id !== actor.id)
  const assignees = (data.assignees ?? []).filter((a) => a.id !== actor.id)
  let status = data.status
  if (status !== 'done' && assigneeIds.length === 0) {
    status = 'pooled'
  }
  await updateDoc(taskRef, {
    assigneeIds,
    assignees,
    status,
    updatedAt: serverTimestamp(),
  })
  await appendAudit(db, sessionId, 'task_released', actor, { taskId })
}

export async function addComment(
  db: Firestore,
  sessionId: string,
  taskId: string,
  text: string,
  actor: Participant
) {
  const trimmed = text.trim()
  if (!trimmed) return
  await addDoc(commentsCollection(db, sessionId, taskId), {
    text: trimmed,
    createdAt: serverTimestamp(),
    createdBy: actor,
  })
  await appendAudit(db, sessionId, 'comment_added', actor, {
    taskId,
    preview: trimmed.slice(0, 200),
  })
}

export async function uploadTaskAttachment(
  storage: FirebaseStorage,
  db: Firestore,
  sessionId: string,
  taskId: string,
  file: File,
  actor: Participant
) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const objectPath = `sessions/${sessionId}/tasks/${taskId}/${crypto.randomUUID()}_${safeName}`
  const sref = ref(storage, objectPath)
  await uploadBytes(sref, file, {
    contentType: file.type || 'application/octet-stream',
  })
  const taskRef = doc(db, 'sessions', sessionId, 'tasks', taskId)
  const snap = await getDoc(taskRef)
  const prev = (snap.data() as TaskDoc | undefined)?.attachments ?? []
  const attachments = [
    ...prev,
    {
      storagePath: objectPath,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      uploadedAt: serverTimestamp(),
      uploadedBy: actor,
    },
  ]
  await updateDoc(taskRef, { attachments, updatedAt: serverTimestamp() })
  await appendAudit(db, sessionId, 'attachment_added', actor, {
    taskId,
    fileName: file.name,
  })
  return getDownloadURL(sref)
}

function serializeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString()
  }
  if (Array.isArray(v)) return v.map(serializeValue)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(Object.entries(o).map(([k, val]) => [k, serializeValue(val)]))
  }
  return v
}

export async function exportSessionSnapshot(db: Firestore, sessionId: string) {
  const sessionSnap = await getDoc(doc(db, 'sessions', sessionId))
  const session = sessionSnap.exists() ? serializeValue(sessionSnap.data()) : null
  const tasksSnap = await getDocs(query(tasksCollection(db, sessionId), orderBy('createdAt', 'desc')))
  const tasks: unknown[] = []
  for (const t of tasksSnap.docs) {
    const commentsSnap = await getDocs(
      query(commentsCollection(db, sessionId, t.id), orderBy('createdAt', 'asc'))
    )
    tasks.push({
      id: t.id,
      ...((serializeValue(t.data()) as object) ?? {}),
      comments: commentsSnap.docs.map((d) => ({
        id: d.id,
        ...((serializeValue(d.data()) as object) ?? {}),
      })),
    })
  }
  const auditSnap = await getDocs(query(auditCollection(db, sessionId), orderBy('at', 'asc')))
  const audit = auditSnap.docs.map((d) => ({
    id: d.id,
    ...((serializeValue(d.data()) as object) ?? {}),
  }))
  return {
    exportedAt: new Date().toISOString(),
    sessionId,
    session,
    tasks,
    audit,
  }
}
