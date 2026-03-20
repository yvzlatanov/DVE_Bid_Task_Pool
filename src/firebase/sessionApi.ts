import {
  addDoc,
  collection,
  doc,
  getDoc,
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
import { normalizeEmail } from '../lib/participant'
import type {
  AuditEventType,
  CommentDoc,
  Participant,
  SessionDoc,
  SessionParticipantDoc,
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

function subtasksCollection(db: Firestore, sessionId: string, taskId: string) {
  return collection(db, 'sessions', sessionId, 'tasks', taskId, 'subtasks')
}

function subtaskCommentsCollection(
  db: Firestore,
  sessionId: string,
  taskId: string,
  subtaskId: string
) {
  return collection(db, 'sessions', sessionId, 'tasks', taskId, 'subtasks', subtaskId, 'comments')
}

function participantsCollection(db: Firestore, sessionId: string) {
  return collection(db, 'sessions', sessionId, 'participants')
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

export function subscribeParticipants(
  db: Firestore,
  sessionId: string,
  onData: (list: { id: string; data: SessionParticipantDoc }[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    participantsCollection(db, sessionId),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, data: d.data() as SessionParticipantDoc }))
      onData(list)
    },
    (err) => onError?.(err)
  )
}

/** Heartbeat so others see you in the session roster. Call on mount and on an interval. */
export async function upsertSessionPresence(
  db: Firestore,
  sessionId: string,
  participant: Participant
) {
  const pref = doc(participantsCollection(db, sessionId), participant.id)
  const snap = await getDoc(pref)
  const base: Record<string, unknown> = {
    id: participant.id,
    displayName: participant.displayName,
    email: participant.email,
    lastSeen: serverTimestamp(),
  }
  if (!snap.exists()) {
    base.joinedAt = serverTimestamp()
  }
  await setDoc(pref, base, { merge: true })
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
  const actorEm = normalizeEmail(actor.email)
  const assignees = (data.assignees ?? []).filter((a) => normalizeEmail(a.email) !== actorEm)
  const assigneeIds = assignees.map((a) => a.id)
  if (assigneeIds.includes(actor.id)) return
  const mini = { id: actor.id, displayName: actor.displayName, email: actor.email }
  await updateDoc(taskRef, {
    assigneeIds: [...assigneeIds, actor.id],
    assignees: [...assignees, mini],
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
  const actorEm = normalizeEmail(actor.email)
  const assignees = (data.assignees ?? []).filter(
    (a) => a.id !== actor.id && normalizeEmail(a.email) !== actorEm
  )
  const assigneeIds = assignees.map((a) => a.id)
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

export function subscribeSubtasks(
  db: Firestore,
  sessionId: string,
  taskId: string,
  onData: (subtasks: { id: string; data: TaskDoc }[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const q = query(subtasksCollection(db, sessionId, taskId), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, data: d.data() as TaskDoc }))
      onData(list)
    },
    (err) => onError?.(err)
  )
}

export async function createSubtask(
  db: Firestore,
  sessionId: string,
  taskId: string,
  input: {
    title: string
    description: string
    priority: TaskPriority
    links: TaskLink[]
  },
  actor: Participant
) {
  const subRef = doc(subtasksCollection(db, sessionId, taskId))
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
  await setDoc(subRef, payload)
  await appendAudit(db, sessionId, 'subtask_created', actor, {
    taskId,
    subtaskId: subRef.id,
    title: payload.title,
    priority: payload.priority,
  })
  return subRef.id
}

export async function updateSubtaskDetails(
  db: Firestore,
  sessionId: string,
  taskId: string,
  subtaskId: string,
  patch: Partial<{
    title: string
    description: string
    priority: TaskPriority
    status: TaskStatus
    links: TaskLink[]
  }>,
  actor: Participant
) {
  const subRef = doc(db, 'sessions', sessionId, 'tasks', taskId, 'subtasks', subtaskId)
  const clean: Record<string, unknown> = { updatedAt: serverTimestamp() }
  if (patch.title !== undefined) clean.title = patch.title.trim()
  if (patch.description !== undefined) clean.description = patch.description.trim()
  if (patch.priority !== undefined) clean.priority = patch.priority
  if (patch.status !== undefined) clean.status = patch.status
  if (patch.links !== undefined) clean.links = patch.links.filter((l) => l.url.trim())
  await updateDoc(subRef, clean)
  await appendAudit(db, sessionId, 'subtask_updated', actor, { taskId, subtaskId, patch })
}

export async function claimSubtask(
  db: Firestore,
  sessionId: string,
  taskId: string,
  subtaskId: string,
  actor: Participant
) {
  const taskRef = doc(db, 'sessions', sessionId, 'tasks', taskId)
  const subRef = doc(db, 'sessions', sessionId, 'tasks', taskId, 'subtasks', subtaskId)
  const snap = await getDoc(subRef)
  if (!snap.exists()) throw new Error('Subtask not found')
  const data = snap.data() as TaskDoc
  if (data.status === 'done') throw new Error('Cannot claim a completed subtask')

  const parentSnap = await getDoc(taskRef)
  if (!parentSnap.exists()) throw new Error('Task not found')
  if ((parentSnap.data() as TaskDoc).status === 'done') {
    throw new Error('Cannot work on a subtask while the parent task is completed')
  }

  await claimTask(db, sessionId, taskId, actor)

  const actorEm = normalizeEmail(actor.email)
  const assignees = (data.assignees ?? []).filter((a) => normalizeEmail(a.email) !== actorEm)
  const assigneeIds = assignees.map((a) => a.id)
  if (assigneeIds.includes(actor.id)) return
  const mini = { id: actor.id, displayName: actor.displayName, email: actor.email }
  await updateDoc(subRef, {
    assigneeIds: [...assigneeIds, actor.id],
    assignees: [...assignees, mini],
    status: 'in_progress',
    updatedAt: serverTimestamp(),
  })
  await appendAudit(db, sessionId, 'subtask_claimed', actor, { taskId, subtaskId })
}

export async function releaseSubtask(
  db: Firestore,
  sessionId: string,
  taskId: string,
  subtaskId: string,
  actor: Participant
) {
  const subRef = doc(db, 'sessions', sessionId, 'tasks', taskId, 'subtasks', subtaskId)
  const snap = await getDoc(subRef)
  if (!snap.exists()) throw new Error('Subtask not found')
  const data = snap.data() as TaskDoc
  const actorEm = normalizeEmail(actor.email)
  const assignees = (data.assignees ?? []).filter(
    (a) => a.id !== actor.id && normalizeEmail(a.email) !== actorEm
  )
  const assigneeIds = assignees.map((a) => a.id)
  let status = data.status
  if (status !== 'done' && assigneeIds.length === 0) {
    status = 'pooled'
  }
  await updateDoc(subRef, {
    assigneeIds,
    assignees,
    status,
    updatedAt: serverTimestamp(),
  })
  await appendAudit(db, sessionId, 'subtask_released', actor, { taskId, subtaskId })
}

export function subscribeSubtaskComments(
  db: Firestore,
  sessionId: string,
  taskId: string,
  subtaskId: string,
  onData: (comments: { id: string; data: CommentDoc }[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const q = query(
    subtaskCommentsCollection(db, sessionId, taskId, subtaskId),
    orderBy('createdAt', 'asc')
  )
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, data: d.data() as CommentDoc }))
      onData(list)
    },
    (err) => onError?.(err)
  )
}

export async function addSubtaskComment(
  db: Firestore,
  sessionId: string,
  taskId: string,
  subtaskId: string,
  text: string,
  actor: Participant
) {
  const trimmed = text.trim()
  if (!trimmed) return
  await addDoc(subtaskCommentsCollection(db, sessionId, taskId, subtaskId), {
    text: trimmed,
    createdAt: serverTimestamp(),
    createdBy: actor,
  })
  await appendAudit(db, sessionId, 'subtask_comment_added', actor, {
    taskId,
    subtaskId,
    preview: trimmed.slice(0, 200),
  })
}

export async function uploadSubtaskAttachment(
  storage: FirebaseStorage,
  db: Firestore,
  sessionId: string,
  taskId: string,
  subtaskId: string,
  file: File,
  actor: Participant
) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const objectPath = `sessions/${sessionId}/tasks/${taskId}/subtasks/${subtaskId}/${crypto.randomUUID()}_${safeName}`
  const sref = ref(storage, objectPath)
  await uploadBytes(sref, file, {
    contentType: file.type || 'application/octet-stream',
  })
  const subRef = doc(db, 'sessions', sessionId, 'tasks', taskId, 'subtasks', subtaskId)
  const snap = await getDoc(subRef)
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
  await updateDoc(subRef, { attachments, updatedAt: serverTimestamp() })
  await appendAudit(db, sessionId, 'subtask_attachment_added', actor, {
    taskId,
    subtaskId,
    fileName: file.name,
  })
  return getDownloadURL(sref)
}
