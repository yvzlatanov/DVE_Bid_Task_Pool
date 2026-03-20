import type { User } from 'firebase/auth'
import type { Participant } from './types'

/** Normalized email for comparisons and stable IDs (legacy / display). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * @deprecated Legacy email-hash id; new data uses Firebase Auth UID.
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

/** Build Participant from Firebase Auth user (id === uid). */
export function participantFromUser(user: User): Participant {
  const email = user.email ?? ''
  const displayName =
    user.displayName?.trim() ||
    (email ? email.split('@')[0] : 'User')
  return {
    id: user.uid,
    displayName,
    email,
  }
}
