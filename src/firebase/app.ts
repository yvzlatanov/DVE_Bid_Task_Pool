import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions, type Functions } from 'firebase/functions'
import { getStorage } from 'firebase/storage'

function readConfig() {
  const {
    VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID,
  } = import.meta.env

  if (
    !VITE_FIREBASE_API_KEY ||
    !VITE_FIREBASE_AUTH_DOMAIN ||
    !VITE_FIREBASE_PROJECT_ID ||
    !VITE_FIREBASE_STORAGE_BUCKET ||
    !VITE_FIREBASE_MESSAGING_SENDER_ID ||
    !VITE_FIREBASE_APP_ID
  ) {
    return null
  }

  return {
    apiKey: VITE_FIREBASE_API_KEY,
    authDomain: VITE_FIREBASE_AUTH_DOMAIN,
    projectId: VITE_FIREBASE_PROJECT_ID,
    storageBucket: VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: VITE_FIREBASE_APP_ID,
  }
}

let app: FirebaseApp | null = null
let auth: Auth | null = null
let functionsClient: Functions | null = null

export function getFirebaseApp(): FirebaseApp | null {
  if (app) return app
  const config = readConfig()
  if (!config) return null
  app = initializeApp(config)
  return app
}

export function getDb() {
  const a = getFirebaseApp()
  if (!a) return null
  return getFirestore(a)
}

export function getFirebaseAuth(): Auth | null {
  const a = getFirebaseApp()
  if (!a) return null
  if (!auth) auth = getAuth(a)
  return auth
}

export function getFirebaseFunctions(): Functions | null {
  const a = getFirebaseApp()
  if (!a) return null
  if (!functionsClient) {
    const region = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1'
    functionsClient = getFunctions(a, region)
  }
  return functionsClient
}

export function getFirebaseStorage() {
  const a = getFirebaseApp()
  if (!a) return null
  return getStorage(a)
}

export function isFirebaseConfigured(): boolean {
  return readConfig() !== null
}
