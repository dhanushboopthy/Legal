import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/auth/auth-context'
import { PERMISSIONS } from '@/auth/permissions'
import type { UserOut } from '@/types/api'

export const LAWYER_PERMISSIONS: string[] = [
  PERMISSIONS.CASE_SUBMIT,
  PERMISSIONS.CASE_VIEW_OWN,
  PERMISSIONS.PAYMENT_INITIATE,
]
export const ADVOCATE_PERMISSIONS: string[] = [
  PERMISSIONS.CASE_VIEW_ALL,
  PERMISSIONS.CASE_DECIDE,
  PERMISSIONS.CASE_DRAFT,
  PERMISSIONS.USER_MANAGE,
  PERMISSIONS.PAYMENT_VIEW_ALL,
]

export function makeUser(permissions: string[], overrides: Partial<UserOut> = {}): UserOut {
  return {
    id: 'u1',
    full_name: 'Test User',
    email: 'test@example.com',
    phone: null,
    bar_council_id: null,
    role_name: 'unused_by_ui_gating',
    permissions,
    is_active: true,
    is_verified: true,
    ...overrides,
  }
}

export function renderWithProviders(
  ui: ReactElement,
  { user = null, route = '/' }: { user?: UserOut | null; route?: string } = {},
) {
  const auth: AuthContextValue = {
    user,
    status: user ? 'authenticated' : 'unauthenticated',
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    logout: vi.fn(),
  }
  // No retries: a failing request should surface immediately in a test.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext value={auth}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AuthContext>
    </QueryClientProvider>,
  )
}
