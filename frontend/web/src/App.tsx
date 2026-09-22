import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { AuthProvider } from '@/auth/auth-provider'
import { PERMISSIONS } from '@/auth/permissions'
import { RequireAuth } from '@/auth/require-auth'
import { AppShell } from '@/components/layout/app-shell'
import { ErrorBoundary } from '@/components/error-boundary'
import { LoginPage } from '@/features/auth/login-page'
import { PendingApprovalPage } from '@/features/auth/pending-approval-page'
import { RegisterPage } from '@/features/auth/register-page'
import { VerifyEmailPage } from '@/features/auth/verify-email-page'
import { PeoplePage } from '@/features/admin/people-page'
import { PaymentsPage } from '@/features/admin/payments-page'
import { CaseDetailPage } from '@/features/cases/case-detail-page'
import { NewCasePage } from '@/features/cases/new-case-page'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { ForbiddenPage } from '@/features/errors/forbidden-page'
import { NotFoundPage } from '@/features/errors/not-found-page'
import { ServerErrorPage } from '@/features/errors/server-error-page'
import { ProfilePage } from '@/features/profile/profile-page'

// Inside the router so it can reset when the user navigates away from a crash.
function AppRoutes() {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/pending-approval" element={<PendingApprovalPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/cases/:id" element={<CaseDetailPage />} />

            <Route element={<RequireAuth permission={PERMISSIONS.CASE_SUBMIT} />}>
              <Route path="/cases/new" element={<NewCasePage />} />
            </Route>

            <Route element={<RequireAuth permission={PERMISSIONS.USER_MANAGE} />}>
              <Route path="/admin/people" element={<PeoplePage />} />
            </Route>

            <Route element={<RequireAuth permission={PERMISSIONS.PAYMENT_VIEW_ALL} />}>
              <Route path="/admin/payments" element={<PaymentsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="/403" element={<ForbiddenPage />} />
        <Route path="/error" element={<ServerErrorPage />} />
        <Route path="/404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
