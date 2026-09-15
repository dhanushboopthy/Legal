import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { AuthContext, type AuthContextValue } from '@/auth/auth-context'
import { bffLogin, bffLoginWithGoogle, bffLogout, bffRefresh } from '@/lib/bff-client'
import { setSessionExpiredHandler } from '@/lib/api-client'
import { setAccessToken } from '@/lib/token-store'
import type { UserOut } from '@/types/api'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserOut | null>(null)
  const [status, setStatus] = useState<AuthContextValue['status']>('loading')

  const clearSession = useCallback(() => {
    setAccessToken(null)
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  // Silently restore the session on first load using the httpOnly refresh
  // cookie the BFF holds — the access token itself never survives a reload.
  useEffect(() => {
    bffRefresh()
      .then((res) => {
        setAccessToken(res.access_token)
        setUser(res.user)
        setStatus('authenticated')
      })
      .catch(() => {
        clearSession()
      })
  }, [clearSession])

  useEffect(() => {
    setSessionExpiredHandler(clearSession)
    return () => setSessionExpiredHandler(null)
  }, [clearSession])

  const login = useCallback(async (email: string, password: string) => {
    const res = await bffLogin(email, password)
    setAccessToken(res.access_token)
    setUser(res.user)
    setStatus('authenticated')
  }, [])

  const loginWithGoogle = useCallback(async (idToken: string) => {
    const res = await bffLoginWithGoogle(idToken)
    setAccessToken(res.access_token)
    setUser(res.user)
    setStatus('authenticated')
  }, [])

  const logout = useCallback(async () => {
    try {
      await bffLogout()
    } finally {
      clearSession()
    }
  }, [clearSession])

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, loginWithGoogle, logout }),
    [user, status, login, loginWithGoogle, logout],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
