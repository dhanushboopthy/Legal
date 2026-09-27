import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { AuthProvider } from '@/auth/auth-provider'
import { PERMISSIONS } from '@/auth/permissions'
import { RequireAuth } from '@/auth/require-auth'
import { AppShell } from '@/components/layout/app-shell'
import { ErrorBoundary } from '@/components/error-boundary'
import { PageSpinner } from '@/components/ui/page-spinner'
import { ForbiddenPage } from '@/features/errors/forbidden-page'
import { ServerErrorPage } from '@/features/errors/server-error-page'

// Each route's code loads only once it's visited, so the first paint (almost
// always /login) doesn't pay for the case, chat and admin screens up front.
const CompleteProfilePage = lazy(() =>
  import('@/features/auth/complete-profile-page').then((m) => ({ default: m.CompleteProfilePage })),
)
const LoginPage = lazy(() =>
  import('@/features/auth/login-page').then((m) => ({ default: m.LoginPage })),
)
const PendingApprovalPage = lazy(() =>
  import('@/features/auth/pending-approval-page').then((m) => ({ default: m.PendingApprovalPage })),
)
const RegisterPage = lazy(() =>
  import('@/features/auth/register-page').then((m) => ({ default: m.RegisterPage })),
)
const VerifyEmailPage = lazy(() =>
  import('@/features/auth/verify-email-page').then((m) => ({ default: m.VerifyEmailPage })),
)
const PeoplePage = lazy(() =>
  import('@/features/admin/people-page').then((m) => ({ default: m.PeoplePage })),
)
const PaymentsPage = lazy(() =>
  import('@/features/admin/payments-page').then((m) => ({ default: m.PaymentsPage })),
)
const CaseDetailPage = lazy(() =>
  import('@/features/cases/case-detail-page').then((m) => ({ default: m.CaseDetailPage })),
)
const NewCasePage = lazy(() =>
  import('@/features/cases/new-case-page').then((m) => ({ default: m.NewCasePage })),
)
const DashboardPage = lazy(() =>
  import('@/features/dashboard/dashboard-page').then((m) => ({ default: m.DashboardPage })),
)
const MessagesPage = lazy(() =>
  import('@/features/messages/messages-page').then((m) => ({ default: m.MessagesPage })),
)
const NotFoundPage = lazy(() =>
  import('@/features/errors/not-found-page').then((m) => ({ default: m.NotFoundPage })),
)
const ForgotPasswordPage = lazy(() =>
  import('@/features/auth/forgot-password-page').then((m) => ({ default: m.ForgotPasswordPage })),
)
const HelpPage = lazy(() =>
  import('@/features/help/help-page').then((m) => ({ default: m.HelpPage })),
)
const ProfilePage = lazy(() =>
  import('@/features/profile/profile-page').then((m) => ({ default: m.ProfilePage })),
)

// Inside the router so it can reset when the user navigates away from a crash.
function AppRoutes() {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/complete-profile" element={<CompleteProfilePage />} />
          <Route path="/pending-approval" element={<PendingApprovalPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/cases/:id" element={<CaseDetailPage />} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/messages/:caseId" element={<MessagesPage />} />

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
      </Suspense>
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
