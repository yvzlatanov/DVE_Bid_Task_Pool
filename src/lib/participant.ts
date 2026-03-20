import type { Participant } from './types'

const STORAGE_KEY = 'bidtm_participant_v1'

function randomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function getParticipant(): Participant | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Participant
    if (!data?.id || !data?.displayName || !data?.email) return null
    return data
  } catch {
    return null
  }
}

export function saveParticipant(input: {
  displayName: string
  email: string
  id?: string
}): Participant {
  const participant: Participant = {
    id: input.id ?? randomId(),
    displayName: input.displayName.trim(),
    email: input.email.trim(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(participant))
  return participant
}

export function clearParticipant(): void {
  localStorage.removeItem(STORAGE_KEY)
}
