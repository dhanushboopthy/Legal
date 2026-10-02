import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PeoplePage } from '@/features/admin/people-page'
import { apiClient } from '@/lib/api-client'
import { makeUser, renderWithProviders } from '@/test/render-helpers'
import type { UserOut } from '@/types/api'

const me = makeUser(['user:manage'], {
  id: 'me',
  full_name: 'Advocate Rao',
  role_name: 'super_admin',
})
const priya = makeUser([], { id: 'p1', full_name: 'Priya Nair', role_name: 'junior_lawyer' })
const arjun = makeUser([], {
  id: 'a1',
  full_name: 'Arjun Mehta',
  role_name: 'junior_lawyer',
  is_active: false,
  removed_at: '2026-09-20T10:00:00Z',
})
const waiting = makeUser([], {
  id: 'w1',
  full_name: 'Neha Iyer',
  role_name: 'junior_lawyer',
  is_active: false,
})

let api: MockAdapter
beforeEach(() => {
  api = new MockAdapter(apiClient)
  api.onGet('/users').reply(200, [me, priya, arjun, waiting] satisfies UserOut[])
})
afterEach(() => {
  cleanup()
  api.restore()
})

function list(heading: RegExp) {
  return screen.getByRole('heading', { name: heading }).closest('section') ?? document.body
}

describe('PeoplePage', () => {
  it('keeps removed people apart from those waiting for approval', async () => {
    renderWithProviders(<PeoplePage />, { user: me })
    await screen.findByText('Priya Nair')

    expect(within(list(/Waiting for approval \(1\)/)).getByText('Neha Iyer')).toBeInTheDocument()
    const removed = list(/Removed \(1\)/)
    expect(within(removed).getByText('Arjun Mehta')).toBeInTheDocument()
    expect(within(removed).getByRole('button', { name: 'Restore access' })).toBeInTheDocument()
  })

  it('never offers to remove yourself', async () => {
    renderWithProviders(<PeoplePage />, { user: me })
    await screen.findByText('Priya Nair')
    // One Remove button: Priya's. Yours says "You".
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('removes someone after one confirmation that names them', async () => {
    api.onPatch('/users/p1/remove').reply(200, { ...priya, is_active: false, removed_at: 'now' })
    const { toast } = renderWithProviders(<PeoplePage />, { user: me })

    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Remove Priya Nair from the service?')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await vi.waitFor(() => expect(api.history.patch).toHaveLength(1))
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Priya Nair removed' }))
  })

  it('restores someone', async () => {
    api.onPatch('/users/a1/restore').reply(200, { ...arjun, is_active: true, removed_at: null })
    const { toast } = renderWithProviders(<PeoplePage />, { user: me })

    await userEvent.click(await screen.findByRole('button', { name: 'Restore access' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore access' }))

    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Arjun Mehta can sign in again' }),
      ),
    )
  })

  it('shows why a removal was refused', async () => {
    api.onPatch('/users/p1/remove').reply(409, { detail: "You can't remove yourself." })
    const { toast } = renderWithProviders(<PeoplePage />, { user: me })
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }),
    )
    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error', description: "You can't remove yourself." }),
      ),
    )
  })
})
