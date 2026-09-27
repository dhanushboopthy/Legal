import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RegisterPage } from '@/features/auth/register-page'
import { apiClient } from '@/lib/api-client'
import { renderWithProviders } from '@/test/render-helpers'

let api: MockAdapter
beforeEach(() => {
  api = new MockAdapter(apiClient)
})
afterEach(() => {
  cleanup()
  api.restore()
})

describe('RegisterPage', () => {
  it('asks for the Bar Council number up front, so there is no extra screen later', async () => {
    api.onPost('/auth/register').reply(201, {})
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)

    await user.type(screen.getByLabelText('Full name'), 'Priya Shah')
    await user.type(screen.getByLabelText('Email'), 'priya@example.com')
    await user.type(screen.getByLabelText('Bar Council enrolment number'), 'MAH/1234/2015')
    await user.type(screen.getByLabelText('Password'), 'blue river courtroom')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(api.history.post).toHaveLength(1))
    expect(JSON.parse(api.history.post[0]!.data as string)).toMatchObject({
      bar_council_id: 'MAH/1234/2015',
    })
  })

  it('will not submit without the Bar Council number', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)
    await user.type(screen.getByLabelText('Full name'), 'Priya Shah')
    await user.type(screen.getByLabelText('Email'), 'priya@example.com')
    await user.type(screen.getByLabelText('Password'), 'blue river courtroom')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Enter your Bar Council enrolment number')).toBeInTheDocument()
    expect(api.history.post).toHaveLength(0)
  })
})
