import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationBell } from '@/components/layout/notification-bell'
import { renderWithProviders } from '@/test/render-helpers'
import type { NotificationOut } from '@/types/api'

const api = vi.hoisted(() => ({
  listMyNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}))
vi.mock('@/lib/api/notifications', () => api)

const note = (over: Partial<NotificationOut>): NotificationOut => ({
  id: 'n1',
  message: 'Quote sent',
  case_id: 'case-1',
  kind: 'quote_sent',
  is_read: false,
  created_at: new Date().toISOString(),
  ...over,
})

beforeEach(() => {
  api.listMyNotifications.mockReset()
  api.markNotificationRead.mockReset().mockResolvedValue({})
  api.markAllNotificationsRead.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('NotificationBell', () => {
  it('shows the unread count on the bell and groups the list by day', async () => {
    api.listMyNotifications.mockResolvedValue([
      note({ id: 'a', message: 'The advocate sent a draft' }),
      note({ id: 'b', message: 'Old news', is_read: true, created_at: '2020-01-01T10:00:00Z' }),
    ])
    const user = userEvent.setup()
    renderWithProviders(<NotificationBell />)

    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' })
    await user.click(bell)

    const panel = await screen.findByRole('dialog', { name: 'Notifications' })
    expect(within(panel).getByRole('region', { name: 'Today' })).toHaveTextContent('The advocate sent a draft')
    expect(within(panel).getByRole('region', { name: 'Earlier' })).toHaveTextContent('Old news')
  })

  it('"Unread" shows only unread ones, and says so when there are none', async () => {
    api.listMyNotifications.mockResolvedValue([note({ is_read: true })])
    const user = userEvent.setup()
    renderWithProviders(<NotificationBell />)
    await user.click(await screen.findByRole('button', { name: 'Notifications' }))

    await user.click(await screen.findByRole('tab', { name: 'Unread' }))
    expect(screen.getByText('No unread notifications')).toBeInTheDocument()
  })

  it('"Mark all as read" clears the count at once and tells the server', async () => {
    api.listMyNotifications.mockResolvedValue([note({ id: 'a' }), note({ id: 'b' })])
    const user = userEvent.setup()
    renderWithProviders(<NotificationBell />)
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }))

    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }))

    expect(api.markAllNotificationsRead).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Mark all as read' })).toBeDisabled()
  })

  it('opening a notification marks it read and closes the panel', async () => {
    api.listMyNotifications.mockResolvedValue([note({ id: 'a', message: 'Pay now' })])
    const user = userEvent.setup()
    renderWithProviders(<NotificationBell />)
    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))

    await user.click(await screen.findByRole('button', { name: /Pay now/ }))

    await waitFor(() => expect(api.markNotificationRead.mock.calls[0]?.[0]).toBe('a'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a failed load offers a retry instead of "all caught up"', async () => {
    api.listMyNotifications.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    renderWithProviders(<NotificationBell />)
    await user.click(await screen.findByRole('button', { name: 'Notifications' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load notifications")
    expect(screen.queryByText("You're all caught up")).toBeNull()
  })
})
