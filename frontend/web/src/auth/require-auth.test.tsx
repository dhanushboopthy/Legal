import { cleanup, screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { PERMISSIONS } from '@/auth/permissions'
import { RequireAuth } from '@/auth/require-auth'
import {
  ADVOCATE_PERMISSIONS,
  LAWYER_PERMISSIONS,
  makeUser,
  renderWithProviders,
} from '@/test/render-helpers'

afterEach(cleanup)

function GuardedRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route element={<RequireAuth permission={PERMISSIONS.CASE_SUBMIT} />}>
        <Route path="/cases/new" element={<p>new case form</p>} />
      </Route>
    </Routes>
  )
}

describe('RequireAuth', () => {
  it('sends a signed-out visitor to sign in', () => {
    renderWithProviders(<GuardedRoutes />, { route: '/cases/new' })
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('lets someone with the permission through', () => {
    renderWithProviders(<GuardedRoutes />, {
      user: makeUser(LAWYER_PERMISSIONS),
      route: '/cases/new',
    })
    expect(screen.getByText('new case form')).toBeInTheDocument()
  })

  it('shows the 403 page, not a silent redirect, when the permission is missing', () => {
    renderWithProviders(<GuardedRoutes />, {
      user: makeUser(ADVOCATE_PERMISSIONS),
      route: '/cases/new',
    })
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument()
    expect(screen.queryByText('new case form')).toBeNull()
  })

  it('gates on the permission list, not on the role name', () => {
    // Same role_name as a lawyer, but the role was edited to drop case:submit.
    renderWithProviders(<GuardedRoutes />, {
      user: makeUser([PERMISSIONS.CASE_VIEW_OWN], { role_name: 'junior_lawyer' }),
      route: '/cases/new',
    })
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument()
  })
})
