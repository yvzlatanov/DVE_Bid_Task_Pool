import { normalizeEmail } from './participant'
import type { Participant } from './types'

export type CreatedSessionEntry = {
  sessionId: string
  title: string
  createdAt: string
  createdById: string
  /** For matching when participant id format changed; optional on older records */
  createdByEmail?: string
}

export type ParticipatedSessionEntry = {
  sessionId: string
  title: string
  lastJoinedAt: string
  participantId: string
  participantEmail?: string
}

const CREATED_KEY = 'bidtm_created_sessions_v1'
const PARTICIPATED_KEY = 'bidtm_participated_sessions_v1'

function readCreated(): CreatedSessionEntry[] {
  try {
    const raw = localStorage.getItem(CREATED_KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data.filter(
      (e): e is CreatedSessionEntry =>
        e &&
        typeof e === 'object' &&
        typeof (e as CreatedSessionEntry).sessionId === 'string' &&
        typeof (e as CreatedSessionEntry).title === 'string' &&
        typeof (e as CreatedSessionEntry).createdAt === 'string' &&
        typeof (e as CreatedSessionEntry).createdById === 'string'
    )
  } catch {
    return []
  }
}

function writeCreated(entries: CreatedSessionEntry[]) {
  localStorage.setItem(CREATED_KEY, JSON.stringify(entries))
}

function readParticipated(): ParticipatedSessionEntry[] {
  try {
    const raw = localStorage.getItem(PARTICIPATED_KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data.filter(
      (e): e is ParticipatedSessionEntry =>
        e &&
        typeof e === 'object' &&
        typeof (e as ParticipatedSessionEntry).sessionId === 'string' &&
        typeof (e as ParticipatedSessionEntry).title === 'string' &&
        typeof (e as ParticipatedSessionEntry).lastJoinedAt === 'string' &&
        typeof (e as ParticipatedSessionEntry).participantId === 'string'
    )
  } catch {
    return []
  }
}

function writeParticipated(entries: ParticipatedSessionEntry[]) {
  localStorage.setItem(PARTICIPATED_KEY, JSON.stringify(entries))
}

export function recordCreatedSession(participant: Participant, sessionId: string, title: string) {
  const entries = readCreated()
  if (entries.some((e) => e.sessionId === sessionId)) return
  entries.unshift({
    sessionId,
    title: title.trim(),
    createdAt: new Date().toISOString(),
    createdById: participant.id,
    createdByEmail: normalizeEmail(participant.email),
  })
  writeCreated(entries.slice(0, 80))
}

export function getCreatedSessionsForParticipant(participant: Participant): CreatedSessionEntry[] {
  const em = normalizeEmail(participant.email)
  return readCreated().filter(
    (e) => e.createdById === participant.id || (!!e.createdByEmail && normalizeEmail(e.createdByEmail) === em)
  )
}

export function removeCreatedSession(sessionId: string) {
  writeCreated(readCreated().filter((e) => e.sessionId !== sessionId))
}

export function recordParticipatedSession(participant: Participant, sessionId: string, title: string) {
  const entries = readParticipated()
  const em = normalizeEmail(participant.email)
  const idx = entries.findIndex((e) => e.sessionId === sessionId)
  const row: ParticipatedSessionEntry = {
    sessionId,
    title: title.trim(),
    lastJoinedAt: new Date().toISOString(),
    participantId: participant.id,
    participantEmail: em,
  }
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...row }
  } else {
    entries.unshift(row)
  }
  writeParticipated(entries.slice(0, 80))
}

export function getParticipatedSessionsForParticipant(participant: Participant): ParticipatedSessionEntry[] {
  const em = normalizeEmail(participant.email)
  return readParticipated().filter(
    (e) =>
      e.participantId === participant.id ||
      (!!e.participantEmail && normalizeEmail(e.participantEmail) === em)
  )
}

export function removeParticipatedSession(sessionId: string) {
  writeParticipated(readParticipated().filter((e) => e.sessionId !== sessionId))
}

/** Joined list excluding sessions you started (those stay under “Sessions you started”). */
export function getJoinedSessionsForHome(participant: Participant): ParticipatedSessionEntry[] {
  const createdIds = new Set(getCreatedSessionsForParticipant(participant).map((e) => e.sessionId))
  return getParticipatedSessionsForParticipant(participant).filter((e) => !createdIds.has(e.sessionId))
}
