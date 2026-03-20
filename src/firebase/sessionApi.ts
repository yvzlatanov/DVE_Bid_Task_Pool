import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  deleteField,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage'
import { normalizeEmail } from '../lib/participant'
import type {
  AuditEventType,
  CommentDoc,
  Participant,
  SessionAccessMode,
  SessionDoc,
  SessionMemberDoc,
  SessionParticipantDoc,
  TaskDoc,
  TaskLink,
  TaskPriority,
  TaskStatus,
} from '../lib/types'

export class ConflictError extends Error {
  override name = 'ConflictError'
  constructor(message = 'Someone else saved changes first.') {
    super(message)
  }
}

function updatedAtMillis(ts: Timestamp | undefined): number {
  if (!ts || typeof ts.toMillis !== 'function') return -1
  try {
    return ts.toMillis()
  } catch {
    return -1
  }
}

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

function membersCollection(db: Firestore, sessionId: string) {
  return collection(db, 'sessions', sessionId, 'members')
}

function participantsCollection(db: Firestore, sessionId: string) {
  return collection(db, 'sessions', sessionId, 'participants')
}

/** When there is at least one subtask: parent is done iff all subtasks are done. */
async function syncParentTaskStatusFromSubtasks(
  db: Firestore,
  sessionId: string,
  taskId: string,
  actor: Participant
) {
  const subsSnap = await getDocs(subtasksCollection(db, sessionId, taskId))
  if (subsSnap.empty) return

  const allDone = subsSnap.docs.every((d) => (d.data() as TaskDoc).status === 'done')
  const taskRef = doc(db, 'sessions', sessionId, 'tasks', taskId)
  const taskSnap = await getDoc(taskRef)
  if (!taskSnap.exists()) return
  const taskData = taskSnap.data() as TaskDoc

  if (allDone) {
    if (taskData.status !== 'done') {
      await updateDoc(taskRef, {
        status: 'done',
        updatedAt: serverTimestamp(),
      })
      await appendAudit(db, sessionId, 'task_updated', actor, {
        taskId,
        patch: { status: 'done', syncedFromSubtasks: true },
      })
    }
    return
  }

  if (taskData.status === 'done') {
    const hasAssignees =
      (taskData.assigneeIds?.length ?? 0) > 0 || (taskData.assignees?.length ?? 0) > 0
    const next: TaskStatus = hasAssignees ? 'in_progress' : 'pooled'
    await updateDoc(taskRef, {
      status: next,
      updatedAt: serverTimestamp(),
    })
    await appendAudit(db, sessionId, 'task_updated', actor, {
      taskId,
      patch: { status: next, syncedFromSubtasks: true },
    })
  }
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
  input: {
    title: string
    bidLabel: string
    accessMode: SessionAccessMode
    linkExpiresAt?: Date | null
  },
  actor: Participant
) {
  const batch = writeBatch(db)
  const sref = doc(db, 'sessions', sessionId)
  const sessionPayload: Record<string, unknown> = {
    title: input.title.trim(),
    bidLabel: (input.bidLabel ?? '').trim(),
    status: 'active',
    createdAt: serverTimestamp(),
    createdBy: actor,
    accessMode: input.accessMode,
  }
  if (input.linkExpiresAt) {
    sessionPayload.linkExpiresAt = Timestamp.fromDate(input.linkExpiresAt)
  }
  batch.set(sref, sessionPayload)
  const mref = doc(membersCollection(db, sessionId), actor.id)
  batch.set(mref, {
    role: 'admin',
    email: actor.email,
    displayName: actor.displayName,
    joinedAt: serverTimestamp(),
  })
  await batch.commit()
  await appendAudit(db, sessionId, 'session_created', actor, {
    title: input.title.trim(),
    bidLabel: (input.bidLabel ?? '').trim(),
    accessMode: input.accessMode,
  })
}

/** Self-join as editor when session is link_join and link not expired. */
export async function joinSessionIfAllowed(
  db: Firestore,
  sessionId: string,
  participant: Participant
) {
  const mref = doc(membersCollection(db, sessionId), participant.id)
  const existing = await getDoc(mref)
  if (existing.exists()) return
  const sref = doc(db, 'sessions', sessionId)
  const sSnap = await getDoc(sref)
  if (!sSnap.exists()) throw new Error('Session not found')
  const data = sSnap.data() as SessionDoc
  const mode = data.accessMode ?? 'link_join'
  if (mode !== 'link_join') {
    throw new Error('This session requires an invite to join.')
  }
  if (data.linkExpiresAt && typeof data.linkExpiresAt.toMillis === 'function') {
    if (data.linkExpiresAt.toMillis() < Date.now()) {
      throw new Error('This session link has expired.')
    }
  }
  await setDoc(mref, {
    role: 'editor',
    email: participant.email,
    displayName: participant.displayName,
    joinedAt: serverTimestamp(),
  })
}

export async function updateSessionAccessSettings(
  db: Firestore,
  sessionId: string,
  patch: { accessMode?: SessionAccessMode; linkExpiresAt?: Date | null },
  actor: Participant
) {
  const clean: Record<string, unknown> = {}
  if (patch.accessMode !== undefined) clean.accessMode = patch.accessMode
  if (patch.linkExpiresAt !== undefined) {
    if (patch.linkExpiresAt === null) {
      clean.linkExpiresAt = deleteField()
    } else {
      clean.linkExpiresAt = Timestamp.fromDate(patch.linkExpiresAt)
    }
  }
  if (Object.keys(clean).length === 0) return
  await updateDoc(doc(db, 'sessions', sessionId), clean)
  await appendAudit(db, sessionId, 'session_settings_updated', actor, {
    patch: clean,
  })
}

/** Sessions where the current user has a member doc (collection group). */
export async function fetchSessionIdsForMember(db: Firestore, uid: string): Promise<string[]> {
  const q = query(collectionGroup(db, 'members'), where(documentId(), '==', uid))
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const parent = d.ref.parent
    const sessionRef = parent.parent
    return sessionRef?.id ?? ''
  }).filter(Boolean)
}

export function subscribeMember(
  db: Firestore,
  sessionId: string,
  uid: string,
  onData: (data: SessionMemberDoc | null) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(membersCollection(db, sessionId), uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null)
        return
      }
      onData(snap.data() as SessionMemberDoc)
    },
    (err) => onError?.(err)
  )
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

function normalizeTagList(tags: string[] | undefined): string[] {
  if (!tags?.length) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of tags) {
    const s = t.trim().slice(0, 40)
    if (!s) continue
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
    if (out.length >= 20) break
  }
  return out
}

export async function createTask(
  db: Firestore,
  sessionId: string,
  input: {
    title: string
    description: string
    priority: TaskPriority
    links: TaskLink[]
    tags?: string[]
  },
  actor: Participant
) {
  const taskRef = doc(tasksCollection(db, sessionId))
  const tags = normalizeTagList(input.tags)
  const payload = {
    title: input.title.trim(),
    description: input.description.trim(),
    priority: input.priority,
    status: 'pooled' as TaskStatus,
    assigneeIds: [] as string[],
    assignees: [] as TaskDoc['assignees'],
    links: input.links.filter((l) => l.url.trim()),
    attachments: [] as TaskDoc['attachments'],
    tags,
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
    tags: string[]
  }>,
  actor: Participant,
  expectedUpdatedAt?: Timestamp | null
) {
  if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null) {
    await updateTaskDetailsTransaction(db, sessionId, taskId, patch, actor, expectedUpdatedAt)
    return
  }
  const taskRef = doc(db, 'sessions', sessionId, 'tasks', taskId)
  const clean: Record<string, unknown> = { updatedAt: serverTimestamp() }
  if (patch.title !== undefined) clean.title = patch.title.trim()
  if (patch.description !== undefined) clean.description = patch.description.trim()
  if (patch.priority !== undefined) clean.priority = patch.priority
  if (patch.status !== undefined) clean.status = patch.status
  if (patch.links !== undefined) clean.links = patch.links.filter((l) => l.url.trim())
  if (patch.tags !== undefined) clean.tags = normalizeTagList(patch.tags)
  await updateDoc(taskRef, clean)
  await appendAudit(db, sessionId, 'task_updated', actor, { taskId, patch })
}

async function updateTaskDetailsTransaction(
  db: Firestore,
  sessionId: string,
  taskId: string,
  patch: Partial<{
    title: string
    description: string
    priority: TaskPriority
    status: TaskStatus
    links: TaskLink[]
    tags: string[]
  }>,
  actor: Participant,
  expectedUpdatedAt: Timestamp
) {
  const taskRef = doc(db, 'sessions', sessionId, 'tasks', taskId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(taskRef)
    if (!snap.exists()) throw new Error('Task not found')
    const cur = snap.data() as TaskDoc
    if (updatedAtMillis(cur.updatedAt) !== updatedAtMillis(expectedUpdatedAt)) {
      throw new ConflictError()
    }
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() }
    if (patch.title !== undefined) clean.title = patch.title.trim()
    if (patch.description !== undefined) clean.description = patch.description.trim()
    if (patch.priority !== undefined) clean.priority = patch.priority
    if (patch.status !== undefined) clean.status = patch.status
    if (patch.links !== undefined) clean.links = patch.links.filter((l) => l.url.trim())
    if (patch.tags !== undefined) clean.tags = normalizeTagList(patch.tags)
    tx.update(taskRef, clean)
  })
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
    tags?: string[]
  },
  actor: Participant
) {
  const subRef = doc(subtasksCollection(db, sessionId, taskId))
  const tags = normalizeTagList(input.tags)
  const payload = {
    title: input.title.trim(),
    description: input.description.trim(),
    priority: input.priority,
    status: 'pooled' as TaskStatus,
    assigneeIds: [] as string[],
    assignees: [] as TaskDoc['assignees'],
    links: input.links.filter((l) => l.url.trim()),
    attachments: [] as TaskDoc['attachments'],
    tags,
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
  await syncParentTaskStatusFromSubtasks(db, sessionId, taskId, actor)
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
    tags: string[]
  }>,
  actor: Participant,
  expectedUpdatedAt?: Timestamp | null
) {
  const subRef = doc(db, 'sessions', sessionId, 'tasks', taskId, 'subtasks', subtaskId)
  if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null) {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(subRef)
      if (!snap.exists()) throw new Error('Subtask not found')
      const cur = snap.data() as TaskDoc
      if (updatedAtMillis(cur.updatedAt) !== updatedAtMillis(expectedUpdatedAt)) {
        throw new ConflictError()
      }
      const clean: Record<string, unknown> = { updatedAt: serverTimestamp() }
      if (patch.title !== undefined) clean.title = patch.title.trim()
      if (patch.description !== undefined) clean.description = patch.description.trim()
      if (patch.priority !== undefined) clean.priority = patch.priority
      if (patch.status !== undefined) clean.status = patch.status
      if (patch.links !== undefined) clean.links = patch.links.filter((l) => l.url.trim())
      if (patch.tags !== undefined) clean.tags = normalizeTagList(patch.tags)
      tx.update(subRef, clean)
    })
  } else {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() }
    if (patch.title !== undefined) clean.title = patch.title.trim()
    if (patch.description !== undefined) clean.description = patch.description.trim()
    if (patch.priority !== undefined) clean.priority = patch.priority
    if (patch.status !== undefined) clean.status = patch.status
    if (patch.links !== undefined) clean.links = patch.links.filter((l) => l.url.trim())
    if (patch.tags !== undefined) clean.tags = normalizeTagList(patch.tags)
    await updateDoc(subRef, clean)
  }
  await appendAudit(db, sessionId, 'subtask_updated', actor, { taskId, subtaskId, patch })
  await syncParentTaskStatusFromSubtasks(db, sessionId, taskId, actor)
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
