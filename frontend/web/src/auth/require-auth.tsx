import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { destinationFor } from '@/auth/destination'
import type { Permission } from '@/auth/permissions'
import { usePermissions } from '@/auth/use-permissions'
import { PageSpinner } from '@/components/ui/page-spinner'
import { ForbiddenPage } from '@/features/errors/forbidden-page'

export function RequireAuth({ permission }: { permission?: Permission }) {
  const { user, status } = useAuth()
  const { can } = usePermissions()
  const location = useLocation()

  if (status === 'loading') return <PageSpinner />

  if (status === 'unauthenticated' || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  const destination = destinationFor(user)
  if (destination !== '/') {
    return <Navigate to={destination} replace />
  }

  if (permission && !can(permission)) {
    return <ForbiddenPage inline />
  }

  return <Outlet />
}
