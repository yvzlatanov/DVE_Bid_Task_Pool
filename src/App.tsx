import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { FirebaseMissing } from './components/FirebaseMissing'
import { isFirebaseConfigured } from './firebase/app'
import { FinishEmailSignInPage } from './pages/FinishEmailSignInPage'
import { HomePage } from './pages/HomePage'
import { JoinInvitePage } from './pages/JoinInvitePage'
import { LoginPage } from './pages/LoginPage'
import { SessionPage } from './pages/SessionPage'

export function App() {
  if (!isFirebaseConfigured()) {
    return <FirebaseMissing />
  }
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/finish-email-signin" element={<FinishEmailSignInPage />} />
        <Route path="/join" element={<JoinInvitePage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <HomePage />
            </RequireAuth>
          }
        />
        <Route
          path="/session/:sessionId"
          element={
            <RequireAuth>
              <SessionPage />
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  )
}
