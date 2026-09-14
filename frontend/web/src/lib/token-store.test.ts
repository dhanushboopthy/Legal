import { describe, expect, it, vi } from 'vitest'

import { getAccessToken, setAccessToken, subscribeToAccessToken } from '@/lib/token-store'

describe('token-store', () => {
  it('starts with no token and reflects what is set', () => {
    setAccessToken(null)
    expect(getAccessToken()).toBeNull()

    setAccessToken('abc123')
    expect(getAccessToken()).toBe('abc123')
  })

  it('notifies subscribers on change and supports unsubscribing', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToAccessToken(listener)

    setAccessToken('token-1')
    expect(listener).toHaveBeenCalledWith('token-1')

    unsubscribe()
    setAccessToken('token-2')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
