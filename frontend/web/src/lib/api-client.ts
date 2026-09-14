import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

import { bffRefresh } from '@/lib/bff-client'
import { getAccessToken, setAccessToken } from '@/lib/token-store'

// Talks to the FastAPI backend (proxied at /api in dev and prod so it's
// always same-origin). Every request gets the in-memory access token; a
// 401 triggers exactly one refresh attempt via the BFF, then retries once.
export const apiClient = axios.create({ baseURL: '/api' })

let onSessionExpired: (() => void) | null = null
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler
}

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  refreshPromise ??= bffRefresh()
    .then((res) => {
      setAccessToken(res.access_token)
      return res.access_token
    })
    .catch(() => {
      setAccessToken(null)
      return null
    })
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined
    if (error.response?.status !== 401 || !config || config._retried) {
      throw error
    }

    config._retried = true
    const newToken = await refreshAccessToken()
    if (!newToken) {
      onSessionExpired?.()
      throw error
    }

    config.headers.set('Authorization', `Bearer ${newToken}`)
    return apiClient(config)
  },
)
