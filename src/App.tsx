import { Route, Routes } from 'react-router-dom'
import { FirebaseMissing } from './components/FirebaseMissing'
import { isFirebaseConfigured } from './firebase/app'
import { HomePage } from './pages/HomePage'
import { SessionPage } from './pages/SessionPage'

export function App() {
  if (!isFirebaseConfigured()) {
    return <FirebaseMissing />
  }
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/session/:sessionId" element={<SessionPage />} />
    </Routes>
  )
}
