import { useMemo } from 'react'

import { useAuth } from '@/auth/auth-context'
import type { CanFn } from '@/auth/permissions'

export function usePermissions(): { can: CanFn } {
  const { user } = useAuth()
  return useMemo(() => {
    const granted = new Set(user?.permissions ?? [])
    return { can: (permission) => granted.has(permission) }
  }, [user])
}
