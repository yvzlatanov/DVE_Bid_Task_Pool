import { createHash, randomBytes } from 'crypto'
import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

admin.initializeApp()

const region = process.env.FUNCTIONS_REGION || 'us-central1'

export const createSessionInvite = onCall({ region }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required')
  }
  const sessionId = request.data?.sessionId as string | undefined
  if (!sessionId) {
    throw new HttpsError('invalid-argument', 'sessionId required')
  }
  const role = request.data?.role === 'viewer' ? 'viewer' : 'editor'
  const maxUses = Math.min(100, Math.max(1, Number(request.data?.maxUses) || 5))
  const expiresInDays = Math.min(365, Math.max(1, Number(request.data?.expiresInDays) || 30))

  const memberSnap = await admin
    .firestore()
    .doc(`sessions/${sessionId}/members/${request.auth.uid}`)
    .get()
  if (!memberSnap.exists || memberSnap.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only session admins can create invites')
  }

  const inviteId = randomBytes(16).toString('hex')
  const secret = randomBytes(32).toString('hex')
  const secretHash = createHash('sha256').update(secret, 'utf8').digest('hex')
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + expiresInDays * 86400000)

  await admin.firestore().doc(`sessions/${sessionId}/invites/${inviteId}`).set({
    secretHash,
    role,
    maxUses,
    uses: 0,
    expiresAt,
    createdBy: request.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  return { inviteId, secret }
})

export const redeemSessionInvite = onCall({ region }, async (request) => {
  const auth = request.auth
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Sign in required')
  }
  const sessionId = request.data?.sessionId as string | undefined
  const inviteId = request.data?.inviteId as string | undefined
  const secret = request.data?.secret as string | undefined
  if (!sessionId || !inviteId || !secret) {
    throw new HttpsError('invalid-argument', 'sessionId, inviteId, and secret are required')
  }

  const inviteRef = admin.firestore().doc(`sessions/${sessionId}/invites/${inviteId}`)
  const memberRef = admin.firestore().doc(`sessions/${sessionId}/members/${auth.uid}`)

  await admin.firestore().runTransaction(async (tx) => {
    const existingMember = await tx.get(memberRef)
    if (existingMember.exists) {
      return
    }
    const inv = await tx.get(inviteRef)
    if (!inv.exists) {
      throw new HttpsError('not-found', 'Invalid invite')
    }
    const d = inv.data()!
    const exp = d.expiresAt as admin.firestore.Timestamp
    if (exp.toMillis() < Date.now()) {
      throw new HttpsError('failed-precondition', 'Invite expired')
    }
    if (d.uses >= d.maxUses) {
      throw new HttpsError('failed-precondition', 'Invite has no uses left')
    }
    const hash = createHash('sha256').update(secret, 'utf8').digest('hex')
    if (hash !== d.secretHash) {
      throw new HttpsError('permission-denied', 'Invalid invite secret')
    }

    tx.update(inviteRef, { uses: admin.firestore.FieldValue.increment(1) })
    tx.set(memberRef, {
      role: d.role,
      email: auth.token.email ?? '',
      displayName: (auth.token.name as string) || auth.token.email || 'User',
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  })

  return { ok: true }
})
