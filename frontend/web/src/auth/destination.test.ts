import { describe, expect, it } from 'vitest'

import { destinationFor } from '@/auth/destination'
import type { UserOut } from '@/types/api'

const base: UserOut = {
  id: 'u1',
  full_name: 'Test User',
  email: 'test@example.com',
  phone: null,
  bar_council_id: 'BAR-0001',
  role_name: 'junior_lawyer',
  permissions: [],
  is_active: true,
  is_verified: true,
  created_at: '2026-09-15T10:00:00Z',
}

describe('destinationFor', () => {
  it('sends a signup with no Bar Council ID to complete their profile first', () => {
    expect(destinationFor({ ...base, bar_council_id: null, is_active: false })).toBe(
      '/complete-profile',
    )
    // Even one that's somehow already active — the ID is collected either way.
    expect(destinationFor({ ...base, bar_council_id: null, is_active: true })).toBe(
      '/complete-profile',
    )
  })

  it('sends a fully set-up but unapproved account to pending-approval', () => {
    expect(destinationFor({ ...base, is_active: false })).toBe('/pending-approval')
  })

  it('sends a fully set-up, approved account in', () => {
    expect(destinationFor(base)).toBe('/')
  })
})
