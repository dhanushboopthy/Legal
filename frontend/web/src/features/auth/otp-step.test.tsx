import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OtpStep } from '@/features/auth/otp-step'
import { apiClient } from '@/lib/api-client'
import { renderWithProviders } from '@/test/render-helpers'
import type { UserOut } from '@/types/api'

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

let api: MockAdapter

beforeEach(() => {
  api = new MockAdapter(apiClient)
  sessionStorage.clear()
})

const verifiedUser: UserOut = {
  id: 'u1',
  full_name: 'New Lawyer',
  email: 'new@example.com',
  phone: null,
  bar_council_id: null,
  role_name: 'junior_lawyer',
  permissions: [],
  is_active: false,
  is_verified: true,
  created_at: '2026-09-15T10:00:00Z',
}

describe('OtpStep', () => {
  it('auto-submits at 6 digits with no extra tap', async () => {
    const user = userEvent.setup()
    const verifyEmail = vi.fn().mockResolvedValue(verifiedUser)
    const onVerified = vi.fn()

    renderWithProviders(<OtpStep email="new@example.com" onVerified={onVerified} />, {
      authOverrides: { verifyEmail },
    })

    await user.type(screen.getByLabelText('Verification code'), '123456')

    await waitFor(() => expect(verifyEmail).toHaveBeenCalledWith('new@example.com', '123456'))
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(verifiedUser))
  })

  it('shows the server error and lets the person retype instead of getting stuck', async () => {
    const user = userEvent.setup()
    const verifyEmail = vi.fn().mockRejectedValue({
      isAxiosError: true,
      response: { status: 422, data: { detail: 'Invalid or expired code' } },
    })

    renderWithProviders(<OtpStep email="new@example.com" onVerified={vi.fn()} />, {
      authOverrides: { verifyEmail },
    })

    await user.type(screen.getByLabelText('Verification code'), '000000')

    expect(await screen.findByText('Invalid or expired code')).toBeInTheDocument()
  })

  it('remembers the resend cooldown across a remount (a refresh)', async () => {
    api.onPost('/auth/resend-otp').reply(204)
    const user = userEvent.setup()

    const first = renderWithProviders(<OtpStep email="new@example.com" onVerified={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Resend code' }))
    expect(await screen.findByRole('button', { name: /Resend in \d+s/ })).toBeInTheDocument()
    first.unmount()

    renderWithProviders(<OtpStep email="new@example.com" onVerified={vi.fn()} />)
    // Still cooling down — a fresh mount didn't reset it to "Resend code".
    expect(screen.getByRole('button', { name: /Resend in \d+s/ })).toBeInTheDocument()
  })
})
