import {
  GoogleAuthProvider,
  OAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  reload,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getFirebaseAuth } from '../firebase/app'
import { participantFromUser } from '../lib/participant'
import type { Participant } from '../lib/types'

const EMAIL_LINK_STORAGE = 'bidtm_email_link_pending'

type AuthContextValue = {
  user: User | null
  participant: Participant | null
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signInWithMicrosoft: () => Promise<void>
  sendEmailLink: (email: string) => Promise<void>
  completeEmailLinkSignIn: (email: string) => Promise<void>
  signOut: () => Promise<void>
  updateDisplayName: (name: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const auth = getFirebaseAuth()
    if (!auth) {
      setLoading(false)
      return
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  const participant = useMemo(() => (user ? participantFromUser(user) : null), [user])

  const signInWithGoogle = useCallback(async () => {
    const auth = getFirebaseAuth()
    if (!auth) throw new Error('Auth not available')
    const provider = new GoogleAuthProvider()
    await signInWithPopup(auth, provider)
  }, [])

  const signInWithMicrosoft = useCallback(async () => {
    const auth = getFirebaseAuth()
    if (!auth) throw new Error('Auth not available')
    const provider = new OAuthProvider('microsoft.com')
    await signInWithPopup(auth, provider)
  }, [])

  const sendEmailLink = useCallback(async (email: string) => {
    const auth = getFirebaseAuth()
    if (!auth) throw new Error('Auth not available')
    const url = `${window.location.origin}/finish-email-signin`
    const actionCodeSettings = {
      url,
      handleCodeInApp: true,
    }
    await sendSignInLinkToEmail(auth, email.trim(), actionCodeSettings)
    window.localStorage.setItem(EMAIL_LINK_STORAGE, email.trim())
  }, [])

  const completeEmailLinkSignIn = useCallback(async (email: string) => {
    const auth = getFirebaseAuth()
    if (!auth) throw new Error('Auth not available')
    if (!isSignInWithEmailLink(auth, window.location.href)) {
      throw new Error('Invalid sign-in link')
    }
    await signInWithEmailLink(auth, email.trim(), window.location.href)
    window.localStorage.removeItem(EMAIL_LINK_STORAGE)
  }, [])

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth()
    if (!auth) return
    await firebaseSignOut(auth)
  }, [])

  const updateDisplayName = useCallback(async (name: string) => {
    const auth = getFirebaseAuth()
    if (!auth?.currentUser) throw new Error('Not signed in')
    await updateProfile(auth.currentUser, { displayName: name.trim() })
    await reload(auth.currentUser)
    setUser(auth.currentUser)
  }, [])

  const value = useMemo(
    () => ({
      user,
      participant,
      loading,
      signInWithGoogle,
      signInWithMicrosoft,
      sendEmailLink,
      completeEmailLinkSignIn,
      signOut,
      updateDisplayName,
    }),
    [
      user,
      participant,
      loading,
      signInWithGoogle,
      signInWithMicrosoft,
      sendEmailLink,
      completeEmailLinkSignIn,
      signOut,
      updateDisplayName,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function getPendingEmailLinkAddress(): string | null {
  try {
    return window.localStorage.getItem(EMAIL_LINK_STORAGE)
  } catch {
    return null
  }
}

export function isAuthEmailLinkUrl(): boolean {
  const auth = getFirebaseAuth()
  if (!auth) return false
  try {
    return isSignInWithEmailLink(auth, window.location.href)
  } catch {
    return false
  }
}
