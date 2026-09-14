import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AuthProvider } from '@/auth/auth-provider'
import { RequireAuth } from '@/auth/require-auth'
import { AppShell } from '@/components/layout/app-shell'
import { LoginPage } from '@/features/auth/login-page'
import { RegisterPage } from '@/features/auth/register-page'
import { PendingUsersPage } from '@/features/admin/pending-users-page'
import { PaymentsPage } from '@/features/admin/payments-page'
import { CaseDetailPage } from '@/features/cases/case-detail-page'
import { NewCasePage } from '@/features/cases/new-case-page'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { NotFoundPage } from '@/features/not-found/not-found-page'
import { ProfilePage } from '@/features/profile/profile-page'

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/cases/:id" element={<CaseDetailPage />} />

              <Route element={<RequireAuth roles={['junior_lawyer']} />}>
                <Route path="/cases/new" element={<NewCasePage />} />
              </Route>

              <Route element={<RequireAuth roles={['super_admin']} />}>
                <Route path="/admin/pending-users" element={<PendingUsersPage />} />
                <Route path="/admin/payments" element={<PaymentsPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="/404" element={<NotFoundPage />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
