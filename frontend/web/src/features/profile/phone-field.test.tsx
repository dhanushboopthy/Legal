import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PhoneField } from '@/features/profile/phone-field'
import { apiClient } from '@/lib/api-client'
import { renderWithProviders } from '@/test/render-helpers'

let api: MockAdapter
beforeEach(() => {
  api = new MockAdapter(apiClient)
})
afterEach(() => {
  cleanup()
  api.restore()
  sessionStorage.clear()
})

describe('PhoneField', () => {
  it('offers to add a number when there is none yet, and shows it once there is', () => {
    renderWithProviders(<PhoneField phone={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add/ })).toBeInTheDocument()

    const { unmount } = renderWithProviders(<PhoneField phone="9990001111" />)
    expect(screen.getByText('9990001111')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Change/ })).toBeInTheDocument()
    unmount()
  })

  it('texts a code, then verifies it and reports success — the number is never sent without one', async () => {
    api.onPost('/users/me/phone/otp').reply(204)
    api.onPost('/users/me/phone/verify').reply(200, {
      id: 'u1', full_name: 'Test', email: 't@example.com', phone: '9990001111',
      bar_council_id: null, role_name: 'junior_lawyer', permissions: [],
      is_active: true, is_verified: true, created_at: '2026-09-15T10:00:00Z',
    })
    const { toast } = renderWithProviders(<PhoneField phone={null} />)

    await userEvent.click(screen.getByRole('button', { name: /Add/ }))
    await userEvent.type(screen.getByLabelText('Phone'), '9990001111')
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))

    expect(await screen.findByLabelText('Verification code')).toBeInTheDocument()
    expect(JSON.parse(api.history.post[0]?.data as string)).toEqual({ phone: '9990001111' })

    await userEvent.type(screen.getByLabelText('Verification code'), '123456')

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'success', title: 'Phone number verified' }),
      ),
    )
    expect(JSON.parse(api.history.post[1]?.data as string)).toEqual({
      phone: '9990001111',
      code: '123456',
    })
  })

  it('shows the server error on a wrong code without leaving the OTP step', async () => {
    api.onPost('/users/me/phone/otp').reply(204)
    api.onPost('/users/me/phone/verify').reply(422, { detail: 'Incorrect code' })
    renderWithProviders(<PhoneField phone={null} />)

    await userEvent.click(screen.getByRole('button', { name: /Add/ }))
    await userEvent.type(screen.getByLabelText('Phone'), '9990001111')
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await userEvent.type(await screen.findByLabelText('Verification code'), '000000')

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect code')
    expect(screen.getByLabelText('Verification code')).toBeInTheDocument()
  })

  it('surfaces a rejected number without moving to the OTP step', async () => {
    api.onPost('/users/me/phone/otp').reply(422, { detail: 'Enter a 10-digit Indian mobile number' })
    renderWithProviders(<PhoneField phone={null} />)

    await userEvent.click(screen.getByRole('button', { name: /Add/ }))
    await userEvent.type(screen.getByLabelText('Phone'), '12345')
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a 10-digit Indian mobile number',
    )
    expect(screen.queryByLabelText('Verification code')).toBeNull()
  })

  it('lets a new code be requested, cools down, and can jump back to change the number', async () => {
    api.onPost('/users/me/phone/otp').reply(204)
    renderWithProviders(<PhoneField phone={null} />)

    await userEvent.click(screen.getByRole('button', { name: /Add/ }))
    await userEvent.type(screen.getByLabelText('Phone'), '9990001111')
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByLabelText('Verification code')

    const resend = screen.getByRole('button', { name: /Resend/ })
    expect(resend).toBeDisabled()
    expect(resend).toHaveTextContent(/Resend in \d+s/)

    await userEvent.click(screen.getByRole('button', { name: 'Change number' }))
    expect(screen.getByLabelText('Phone')).toHaveValue('9990001111')
  })

  it('cancels back to the view state without saving anything', async () => {
    renderWithProviders(<PhoneField phone="9990001111" />)
    await userEvent.click(screen.getByRole('button', { name: /Change/ }))
    await userEvent.clear(screen.getByLabelText('Phone'))
    await userEvent.type(screen.getByLabelText('Phone'), '8880002222')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('9990001111')).toBeInTheDocument()
    expect(screen.queryByText('8880002222')).toBeNull()
  })

  it('has no automatically detectable accessibility violations at each step', async () => {
    api.onPost('/users/me/phone/otp').reply(204)
    const { container } = renderWithProviders(<PhoneField phone={null} />)
    expect(await axe(container)).toHaveNoViolations()

    await userEvent.click(screen.getByRole('button', { name: /Add/ }))
    expect(await axe(container)).toHaveNoViolations()

    await userEvent.type(screen.getByLabelText('Phone'), '9990001111')
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByLabelText('Verification code')
    expect(await axe(container)).toHaveNoViolations()
  })
})
