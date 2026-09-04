import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { EmployeesPage } from './pages/employees/EmployeesPage'
import { RateBandsPage } from './pages/rateBands/RateBandsPage'
import { HolidaysPage } from './pages/holidays/HolidaysPage'
import { AttendanceSessionsPage } from './pages/attendance/AttendanceSessionsPage'
import { NeedsAttentionPage } from './pages/attendance/NeedsAttentionPage'
import { ReportsPlaceholderPage } from './pages/ReportsPlaceholderPage'

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/rate-bands" element={<RateBandsPage />} />
            <Route path="/holidays" element={<HolidaysPage />} />
            <Route path="/attendance" element={<AttendanceSessionsPage />} />
            <Route path="/attendance/needs-attention" element={<NeedsAttentionPage />} />
            <Route path="/reports" element={<ReportsPlaceholderPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
