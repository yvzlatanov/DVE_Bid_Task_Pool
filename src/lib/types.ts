import type { Timestamp } from 'firebase/firestore'

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskStatus = 'pooled' | 'in_progress' | 'done' | 'blocked'
export type SessionStatus = 'active' | 'archived'

export type Participant = {
  id: string
  displayName: string
  email: string
}

export type TaskLink = {
  label?: string
  url: string
}

export type TaskAttachment = {
  storagePath: string
  fileName: string
  contentType: string
  uploadedAt: Timestamp
  uploadedBy: Participant
}

export type SessionDoc = {
  title: string
  bidLabel: string
  status: SessionStatus
  createdAt: Timestamp
  createdBy: Participant
}

export type TaskDoc = {
  title: string
  description: string
  priority: TaskPriority
  status: TaskStatus
  assigneeIds: string[]
  assignees: { id: string; displayName: string; email: string }[]
  links: TaskLink[]
  attachments: TaskAttachment[]
  createdAt: Timestamp
  updatedAt: Timestamp
  createdBy: Participant
}

export type CommentDoc = {
  text: string
  createdAt: Timestamp
  createdBy: Participant
}

export type AuditEventType =
  | 'session_created'
  | 'task_created'
  | 'task_updated'
  | 'task_claimed'
  | 'task_released'
  | 'comment_added'
  | 'attachment_added'
  | 'session_archived'
  | 'subtask_created'
  | 'subtask_updated'
  | 'subtask_claimed'
  | 'subtask_released'
  | 'subtask_comment_added'
  | 'subtask_attachment_added'

export type AuditEventDoc = {
  type: AuditEventType
  at: Timestamp
  actor: Participant
  payload: Record<string, unknown>
}

/** Presence in a session (doc id === participant id). */
export type SessionParticipantDoc = {
  id: string
  displayName: string
  email: string
  /** Set on first check-in; may be missing on very old documents. */
  joinedAt?: Timestamp
  lastSeen?: Timestamp
}
