import MockAdapter from 'axios-mock-adapter'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiClient, setSessionExpiredHandler } from '@/lib/api-client'
import { setAccessToken } from '@/lib/token-store'

vi.mock('@/lib/bff-client', () => ({
  bffRefresh: vi.fn(),
}))

const { bffRefresh } = await import('@/lib/bff-client')

describe('apiClient 401 refresh flow', () => {
  const mock = new MockAdapter(apiClient)

  beforeEach(() => {
    mock.reset()
    vi.mocked(bffRefresh).mockReset()
    setAccessToken('stale-token')
    setSessionExpiredHandler(null)
  })

  it('retries once with a fresh token after a 401', async () => {
    vi.mocked(bffRefresh).mockResolvedValue({
      access_token: 'fresh-token',
      user: { id: '1' } as never,
    })

    let sawFreshToken = false
    mock.onGet('/cases').replyOnce((config) => {
      if (config.headers?.Authorization === 'Bearer stale-token')
        return [401, { detail: 'expired' }]
      return [500]
    })
    mock.onGet('/cases').replyOnce((config) => {
      sawFreshToken = config.headers?.Authorization === 'Bearer fresh-token'
      return [200, []]
    })

    const res = await apiClient.get('/cases')

    expect(res.status).toBe(200)
    expect(sawFreshToken).toBe(true)
  })

  it('calls the session-expired handler and rethrows when refresh fails', async () => {
    vi.mocked(bffRefresh).mockRejectedValue(new Error('no refresh cookie'))
    const onExpired = vi.fn()
    setSessionExpiredHandler(onExpired)

    mock.onGet('/cases').reply(401, { detail: 'expired' })

    await expect(apiClient.get('/cases')).rejects.toBeTruthy()
    expect(onExpired).toHaveBeenCalledOnce()
  })
})
