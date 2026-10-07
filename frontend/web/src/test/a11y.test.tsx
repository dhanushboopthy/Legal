import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route, Routes } from 'react-router-dom'

import { AppShell } from '@/components/layout/app-shell'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Sheet } from '@/components/ui/sheet'
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page'
import { LoginPage } from '@/features/auth/login-page'
import { RegisterPage } from '@/features/auth/register-page'
import { HelpPage } from '@/features/help/help-page'
import { ADVOCATE_PERMISSIONS, makeUser, renderWithProviders } from '@/test/render-helpers'

vi.mock('@/lib/api/config', () => ({
  getPricing: vi.fn().mockResolvedValue({ review_fee_inr: 100, quote_min_inr: 100, quote_max_inr: 100000 }),
  getSupport: vi
    .fn()
    .mockResolvedValue({ email: 'help@example.com', phone: '+91 22 5555 0100', hours: 'Weekdays' }),
  getUploadRules: vi.fn(),
}))
vi.mock('@/lib/api/notifications', () => ({
  listMyNotifications: vi.fn().mockResolvedValue([]),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}))

afterEach(cleanup)

// Axe pass (6.1): the screens and overlays a person meets before they're
// signed in, plus the two overlay primitives (Dialog, Sheet) everything
// else with a confirmation or a secondary panel is built on. Field and
// error-state a11y wiring (aria-invalid, describedby, role="alert") already
// has its own coverage in field.test.tsx and error-state.test.tsx.
describe('accessibility', () => {
  it('LoginPage has no automatically detectable violations', async () => {
    const { container } = renderWithProviders(<LoginPage />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('RegisterPage has no automatically detectable violations', async () => {
    const { container } = renderWithProviders(<RegisterPage />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('ForgotPasswordPage has no automatically detectable violations', async () => {
    const { container } = renderWithProviders(<ForgotPasswordPage />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('HelpPage, with the contact card, has no automatically detectable violations', async () => {
    const { container } = renderWithProviders(<HelpPage />, {
      user: makeUser(ADVOCATE_PERMISSIONS),
    })
    await screen.findByText(/Call \+91/)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('AppShell navigation has no automatically detectable violations', async () => {
    const { container } = renderWithProviders(
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<h1>Cases</h1>} />
        </Route>
      </Routes>,
      { user: makeUser(ADVOCATE_PERMISSIONS) },
    )
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Cases' })[0]).toHaveAttribute('aria-current', 'page')
    // Sign out lives in one place: the account menu.
    expect(screen.getAllByRole('button', { name: /^Account:/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('ConfirmDialog has no automatically detectable violations', async () => {
    const { container } = render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Refund ₹100 to Priya for "Bail petition"?'
        confirmLabel="Refund"
        onConfirm={vi.fn()}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('Sheet has no automatically detectable violations', async () => {
    const { container } = render(
      <Sheet open onOpenChange={vi.fn()} title="Files" description="What was submitted.">
        <p>original.pdf</p>
      </Sheet>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  // Focus trap and return-on-close are Radix Dialog's own guarantee, used
  // here unmodified (no onOpenAutoFocus/onCloseAutoFocus override). A jsdom
  // regression test for the return-on-close half proved unreliable — jsdom's
  // activeElement tracking across a Portal unmount doesn't consistently
  // match real-browser behaviour — so it isn't asserted here; the trap
  // itself (Tab cannot leave the dialog) is covered below.
  it('traps Tab inside an open ConfirmDialog', async () => {
    const user = userEvent.setup()
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Approve this?"
        confirmLabel="Approve"
        onConfirm={vi.fn()}
      />,
    )
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Approve' })

    await vi.waitFor(() => expect(document.activeElement).not.toBe(document.body))
    await user.tab()
    await user.tab()
    // Two tabs from wherever Radix parks initial focus cycles back inside
    // the dialog's two buttons, never escaping to `document.body`.
    expect([cancel, confirm]).toContain(document.activeElement)
  })
})
