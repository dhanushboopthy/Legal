import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { apiClient } from '@/lib/api-client'
import {
  ADVOCATE_PERMISSIONS,
  LAWYER_PERMISSIONS,
  makeUser,
  renderWithProviders,
} from '@/test/render-helpers'
import type { CaseListItem } from '@/types/api'

const aCase = (over: Partial<CaseListItem> = {}): CaseListItem => ({
  id: 'c1',
  junior_lawyer_id: 'u1',
  title: 'Bail petition',
  case_type: 'Criminal',
  court: null,
  description: null,
  note: null,
  status: 'review_fee_paid',
  rejection_reason: null,
  revision_count: 0,
  created_at: '2026-09-15T10:00:00Z',
  updated_at: '2026-09-15T10:00:00Z',
  last_message: null,
  unread_count: 0,
  turn: 'none',
  junior_lawyer_name: 'Priya Shah',
  junior_lawyer_bar_council_id: 'MH/1234/2020',
  ...over,
})

let mock: MockAdapter
beforeEach(() => {
  mock = new MockAdapter(apiClient)
})
afterEach(() => {
  cleanup()
  mock.restore()
})

describe('DashboardPage states', () => {
  it('says so when the cases request fails, instead of claiming there are none', async () => {
    mock.onGet('/cases').reply(500, { detail: 'An unexpected error occurred' })
    renderWithProviders(<DashboardPage />, { user: makeUser(LAWYER_PERMISSIONS) })

    expect(await screen.findByText("Couldn't load your cases")).toBeInTheDocument()
    expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument()
    expect(screen.queryByText('No cases yet')).toBeNull()
  })

  it('retries from the error state and shows the cases once the server recovers', async () => {
    mock.onGet('/cases').replyOnce(500, { detail: 'boom' })
    mock.onGet('/cases').reply(200, [aCase()])
    renderWithProviders(<DashboardPage />, { user: makeUser(LAWYER_PERMISSIONS) })

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Bail petition')).toBeInTheDocument()
  })

  it('shows the empty state only when the request succeeded with no cases', async () => {
    mock.onGet('/cases').reply(200, [])
    renderWithProviders(<DashboardPage />, { user: makeUser(LAWYER_PERMISSIONS) })

    expect(await screen.findByText('No cases yet')).toBeInTheDocument()
    expect(screen.getByText('Submit your first case to get started.')).toBeInTheDocument()
  })

  it('tells the advocate cases will appear, without a "New case" they cannot use', async () => {
    mock.onGet('/cases').reply(200, [])
    renderWithProviders(<DashboardPage />, { user: makeUser(ADVOCATE_PERMISSIONS) })

    expect(await screen.findByText('No cases yet')).toBeInTheDocument()
    expect(screen.getByText('Cases will appear here once lawyers submit them.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /new case/i })).toBeNull()
  })

  it('does not call an empty filter "no cases yet"', async () => {
    mock.onGet('/cases').reply(200, [aCase()])
    renderWithProviders(<DashboardPage />, { user: makeUser(LAWYER_PERMISSIONS) })

    await screen.findByText('Bail petition')
    await userEvent.click(screen.getByRole('button', { name: 'Rejected' }))

    await waitFor(() => expect(screen.getByText('Nothing in this filter')).toBeInTheDocument())
    expect(screen.queryByText('No cases yet')).toBeNull()
  })

  it("labels each case from the viewer's side", async () => {
    mock.onGet('/cases').reply(200, [aCase({ status: 'review_fee_paid' })])
    const { unmount } = renderWithProviders(<DashboardPage />, {
      user: makeUser(LAWYER_PERMISSIONS),
    })
    expect(await screen.findByText('In review')).toBeInTheDocument()
    unmount()

    renderWithProviders(<DashboardPage />, { user: makeUser(ADVOCATE_PERMISSIONS) })
    expect(await screen.findByText('Needs your decision')).toBeInTheDocument()
  })

  it('shows the last message and how many are unread on a case with a chat', async () => {
    mock.onGet('/cases').reply(200, [
      aCase({
        status: 'accepted',
        unread_count: 3,
        last_message: {
          preview: 'Please share the FIR copy',
          at: '2026-09-15T11:00:00Z',
          sender_name: 'Adv. Rao',
          kind: 'text',
        },
      }),
      aCase({ id: 'c2', title: 'Quiet case' }),
    ])
    renderWithProviders(<DashboardPage />, { user: makeUser(LAWYER_PERMISSIONS) })

    expect(await screen.findByText('Adv. Rao: Please share the FIR copy')).toBeInTheDocument()
    expect(screen.getByLabelText('3 unread messages')).toBeInTheDocument()
    // A case with nothing unread carries no badge.
    expect(screen.getAllByLabelText(/unread/)).toHaveLength(1)
  })
})
