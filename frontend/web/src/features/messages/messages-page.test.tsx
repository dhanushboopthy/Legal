import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import MockAdapter from 'axios-mock-adapter'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MessagesPage } from '@/features/messages/messages-page'
import { apiClient } from '@/lib/api-client'
import {
  ADVOCATE_PERMISSIONS,
  LAWYER_PERMISSIONS,
  makeUser,
  renderWithProviders,
} from '@/test/render-helpers'
import type { CaseListItem, CaseStatus, MessagePage } from '@/types/api'

const ME = 'u-me'

const aCase = (id: string, over: Partial<CaseListItem> = {}): CaseListItem => ({
  id,
  junior_lawyer_id: ME,
  case_number: `LF-2026-000${id.slice(1)}`,
  title: `Case ${id}`,
  case_type: 'Criminal',
  court: null,
  description: null,
  note: null,
  status: 'accepted' as CaseStatus,
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

const emptyThread: MessagePage = {
  messages: [],
  has_more: false,
  my_last_read_id: 0,
  other_last_read_id: 0,
  open: true,
}

let api: MockAdapter
beforeEach(() => {
  api = new MockAdapter(apiClient)
  api.onGet('/config/uploads').reply(200, {
    max_files: 10,
    max_file_size_mb: 25,
    max_case_size_mb: 100,
    accepted: { '.pdf': 'application/pdf' },
  })
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
})
afterEach(() => {
  cleanup()
  api.restore()
  vi.unstubAllGlobals()
})

function mount(route = '/messages', permissions = LAWYER_PERMISSIONS) {
  return renderWithProviders(
    <Routes>
      <Route path="/messages" element={<MessagesPage />} />
      <Route path="/messages/:caseId" element={<MessagesPage />} />
    </Routes>,
    { user: makeUser(permissions, { id: ME }), route },
  )
}

const rows = () =>
  within(screen.getByRole('complementary', { name: 'Conversations' })).getAllByRole('link')

describe('MessagesPage', () => {
  it('lists only the chats the viewer is in, most recent first', async () => {
    api.onGet('/cases').reply(200, [
      aCase('c1', {
        title: 'Older chat',
        last_message: {
          preview: 'See you tomorrow',
          at: '2026-09-20T10:00:00Z',
          sender_id: 'u-advocate',
          sender_name: 'Adv. Rao',
          kind: 'text',
        },
      }),
      aCase('c2', { title: 'Not accepted yet', status: 'review_fee_paid' }),
      aCase('c3', {
        title: 'Newer chat',
        last_message: {
          preview: 'Sent the FIR',
          at: '2026-09-21T10:00:00Z',
          sender_id: ME,
          sender_name: 'Test User',
          kind: 'text',
        },
      }),
    ])
    mount()

    await screen.findByText('Newer chat')
    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('Newer chat'),
      expect.stringContaining('Older chat'),
    ])
    expect(screen.queryByText('Not accepted yet')).toBeNull()
    // The viewer's own last message reads "You: …"; the other side's doesn't get a name.
    expect(screen.getByText('You: Sent the FIR')).toBeInTheDocument()
    expect(screen.getByText('See you tomorrow')).toBeInTheDocument()
  })

  it('marks a conversation with unread messages', async () => {
    api.onGet('/cases').reply(200, [
      aCase('c1', {
        unread_count: 2,
        last_message: {
          preview: 'Please share the FIR copy',
          at: '2026-09-21T10:00:00Z',
          sender_id: 'u-advocate',
          sender_name: 'Adv. Rao',
          kind: 'text',
        },
      }),
    ])
    mount()
    expect(await screen.findByRole('img', { name: '2 unread messages' })).toBeInTheDocument()
  })

  it('says so when the list fails to load, instead of showing no conversations', async () => {
    api.onGet('/cases').reply(500, { detail: 'An unexpected error occurred' })
    mount()
    expect(await screen.findByText("Couldn't load your messages")).toBeInTheDocument()
    expect(screen.queryByText('No conversations yet')).toBeNull()
  })

  it('explains when there are no conversations yet', async () => {
    api.onGet('/cases').reply(200, [aCase('c1', { status: 'submitted' })])
    mount()
    expect(await screen.findByText('No conversations yet')).toBeInTheDocument()
    expect(
      screen.getByText('A chat with the advocate opens once they accept one of your cases.'),
    ).toBeInTheDocument()
  })

  it('opens a conversation with a way back and a link to its case', async () => {
    api.onGet('/cases').reply(200, [aCase('c1', { title: 'Bail petition' })])
    api.onGet('/cases/c1/messages').reply(200, emptyThread)
    mount('/messages/c1')

    expect(await screen.findByRole('region', { name: 'Case chat' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bail petition' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to conversations' })).toHaveAttribute(
      'href',
      '/messages',
    )
    expect(screen.getByRole('link', { name: /View case/ })).toHaveAttribute('href', '/cases/c1')
  })

  it('names the lawyer for the advocate, whose chats are with many lawyers', async () => {
    api.onGet('/cases').reply(200, [
      aCase('c1', { title: 'Bail petition', junior_lawyer_id: 'u-lawyer' }),
    ])
    api.onGet('/cases/c1/messages').reply(200, emptyThread)
    mount('/messages/c1', ADVOCATE_PERMISSIONS)

    await screen.findByRole('region', { name: 'Case chat' })
    expect(screen.getByText(/Priya Shah · /, { selector: 'header p' })).toBeInTheDocument()
  })

  it("won't open a chat the viewer isn't in", async () => {
    api.onGet('/cases').reply(200, [aCase('c1', { status: 'submitted' })])
    mount('/messages/c1')
    expect(await screen.findByText("This conversation isn't available")).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Case chat' })).toBeNull()
    expect(api.history.get.some((r) => r.url === '/cases/c1/messages')).toBe(false)
  })

  it('filters by search', async () => {
    api.onGet('/cases').reply(200, [
      aCase('c1', { title: 'Bail petition' }),
      aCase('c2', { title: 'Property dispute' }),
    ])
    mount()
    await screen.findByText('Bail petition')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search conversations' }), 'prop')
    expect(rows()).toHaveLength(1)
    expect(screen.getByText('Property dispute')).toBeInTheDocument()
  })

  it('has no automatically detectable accessibility violations', async () => {
    api.onGet('/cases').reply(200, [aCase('c1', { title: 'Bail petition', unread_count: 1 })])
    const { container } = mount()
    await screen.findByText('Bail petition')
    expect(await axe(container)).toHaveNoViolations()
  })
})
