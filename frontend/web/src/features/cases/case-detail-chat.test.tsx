import { cleanup, screen, waitFor } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PERMISSIONS } from '@/auth/permissions'
import { CaseDetailPage } from '@/features/cases/case-detail-page'
import { apiClient } from '@/lib/api-client'
import {
  ADVOCATE_PERMISSIONS,
  LAWYER_PERMISSIONS,
  makeUser,
  renderWithProviders,
} from '@/test/render-helpers'
import type { CaseOut, CaseStatus } from '@/types/api'

const OWNER = 'u-owner'
const aCase = (status: CaseStatus): CaseOut => ({
  id: 'c1',
  junior_lawyer_id: OWNER,
  case_number: 'LF-2026-0001',
  title: 'Bail petition',
  case_type: 'Criminal',
  court: null,
  description: null,
  note: null,
  status,
  rejection_reason: null,
  hold_reason: null,
  revision_count: 0,
  created_at: '2026-09-15T10:00:00Z',
  updated_at: '2026-09-15T10:00:00Z',
})

let api: MockAdapter
beforeEach(() => {
  api = new MockAdapter(apiClient)
  api.onGet('/documents/case/c1').reply(200, [])
  api.onGet('/payments/case/c1').reply(200, [])
  api
    .onGet('/config/pricing')
    .reply(200, { review_fee_inr: 100, quote_min_inr: 100, quote_max_inr: 1000 })
  api.onGet('/config/uploads').reply(200, {
    max_files: 10,
    max_file_size_mb: 25,
    max_case_size_mb: 100,
    accepted: { '.pdf': 'application/pdf' },
  })
  api.onGet('/cases').reply(200, [])
  api.onGet('/cases/c1/messages').reply(200, {
    messages: [],
    has_more: false,
    my_last_read_id: 0,
    other_last_read_id: 0,
    open: true,
  })
})
afterEach(() => {
  cleanup()
  api.restore()
})

function open(status: CaseStatus, user: ReturnType<typeof makeUser>) {
  api.onGet('/cases/c1').reply(200, aCase(status))
  return renderWithProviders(
    <Routes>
      <Route path="/cases/:id" element={<CaseDetailPage />} />
    </Routes>,
    { user, route: '/cases/c1' },
  )
}

const chatRequests = () => api.history.get.filter((r) => r.url === '/cases/c1/messages')
const chatLink = () => screen.queryByRole('link', { name: /Messages/ })

describe('who gets the chat on a case', () => {
  it.each(['accepted', 'quoted', 'delivered', 'revision_requested', 'completed'] as CaseStatus[])(
    'gives it to the lawyer who owns the case once it is %s',
    async (status) => {
      open(status, makeUser(LAWYER_PERMISSIONS, { id: OWNER }))
      expect(await screen.findByRole('link', { name: /Messages/ })).toHaveAttribute(
        'href',
        '/messages/c1',
      )
    },
  )

  it('opens the chat on the Messages screen instead of on the case page', async () => {
    open('accepted', makeUser(LAWYER_PERMISSIONS, { id: OWNER }))
    await screen.findByRole('link', { name: /Messages/ })
    expect(screen.queryByRole('region', { name: 'Case chat' })).toBeNull()
    expect(chatRequests()).toHaveLength(0)
  })

  it('gives it to the advocate, who holds case:message', async () => {
    open('accepted', makeUser(ADVOCATE_PERMISSIONS, { id: 'u-advocate' }))
    expect(await screen.findByRole('link', { name: /Messages/ })).toBeInTheDocument()
  })

  it.each(['submitted', 'review_fee_paid', 'rejected', 'draft'] as CaseStatus[])(
    'does not exist yet, or any more, while the case is %s',
    async (status) => {
      open(status, makeUser(LAWYER_PERMISSIONS, { id: OWNER }))
      await screen.findByText('Bail petition')
      expect(chatLink()).toBeNull()
      expect(chatRequests()).toHaveLength(0)
    },
  )

  it('is not shown to someone who can see the case but is not in it (a clerk)', async () => {
    open('accepted', makeUser([PERMISSIONS.CASE_VIEW_ALL], { id: 'u-clerk' }))
    await screen.findByText('Bail petition')
    expect(chatLink()).toBeNull()
    await waitFor(() => expect(api.history.get.length).toBeGreaterThan(0))
    expect(chatRequests()).toHaveLength(0)
  })

  it("is not shown to another lawyer's case", async () => {
    open('accepted', makeUser(LAWYER_PERMISSIONS, { id: 'u-someone-else' }))
    await screen.findByText('Bail petition')
    expect(chatLink()).toBeNull()
  })
})
