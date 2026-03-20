import type { Participant } from './types'

const STORAGE_KEY = 'bidtm_participant_v1'

/** Normalized email for comparisons and stable IDs. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * One Firestore-safe id per email (same browser or not). Used as participant id everywhere.
 */
export function stableParticipantIdFromEmail(email: string): string {
  const n = normalizeEmail(email)
  try {
    const bytes = new TextEncoder().encode(n)
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    const b64 =
      typeof btoa !== 'undefined'
        ? btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        : ''
    if (b64.length > 0) return `m_${b64}`
  } catch {
    /* fall through */
  }
  let h = 2166136261
  for (let i = 0; i < n.length; i++) {
    h ^= n.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `m_f_${(h >>> 0).toString(16)}_${n.length}`
}

export function uniqueAssigneesByEmail<T extends { email: string }>(list: T[] | undefined): T[] {
  if (!list?.length) return []
  const seen = new Set<string>()
  const out: T[] = []
  for (const x of list) {
    const k = normalizeEmail(x.email)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(x)
  }
  return out
}

export function getParticipant(): Participant | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Participant
    if (!data?.displayName || !data?.email) return null
    const id = stableParticipantIdFromEmail(data.email)
    const participant: Participant = {
      id,
      displayName: data.displayName.trim(),
      email: data.email.trim(),
    }
    if (data.id !== id) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(participant))
    }
    return participant
  } catch {
    return null
  }
}

export function saveParticipant(input: { displayName: string; email: string }): Participant {
  const email = input.email.trim()
  const participant: Participant = {
    id: stableParticipantIdFromEmail(email),
    displayName: input.displayName.trim(),
    email,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(participant))
  return participant
}

export function clearParticipant(): void {
  localStorage.removeItem(STORAGE_KEY)
}
