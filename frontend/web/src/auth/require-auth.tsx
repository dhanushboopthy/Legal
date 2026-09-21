import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { PageSpinner } from '@/components/ui/page-spinner'
import { ForbiddenPage } from '@/features/errors/forbidden-page'

export function RequireAuth({ roles }: { roles?: string[] }) {
  const { user, status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <PageSpinner />

  if (status === 'unauthenticated' || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (roles && !roles.includes(user.role_name)) {
    return <ForbiddenPage inline />
  }

  return <Outlet />
}
