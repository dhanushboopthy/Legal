import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { AuthContext, type AuthContextValue } from '@/auth/auth-context'
import { bffLogin, bffLoginWithGoogle, bffLogout, bffRefresh, bffVerifyEmail } from '@/lib/bff-client'
import { setSessionExpiredHandler } from '@/lib/api-client'
import { getMe } from '@/lib/api/users'
import { setAccessToken } from '@/lib/token-store'
import type { UserOut } from '@/types/api'

const statusFor = (user: UserOut): AuthContextValue['status'] =>
  user.is_active ? 'authenticated' : 'pending'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserOut | null>(null)
  const [status, setStatus] = useState<AuthContextValue['status']>('loading')

  const clearSession = useCallback(() => {
    setAccessToken(null)
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  const applySession = (u: UserOut, token: string) => {
    setAccessToken(token)
    setUser(u)
    setStatus(statusFor(u))
  }

  // Silently restore the session on first load using the httpOnly refresh
  // cookie the BFF holds — the access token itself never survives a reload.
  useEffect(() => {
    bffRefresh()
      .then((res) => applySession(res.user, res.access_token))
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
    applySession(res.user, res.access_token)
    return res.user
  }, [])

  const loginWithGoogle = useCallback(async (idToken: string) => {
    const res = await bffLoginWithGoogle(idToken)
    applySession(res.user, res.access_token)
    return res.user
  }, [])

  const verifyEmail = useCallback(async (email: string, code: string) => {
    const res = await bffVerifyEmail(email, code)
    applySession(res.user, res.access_token)
    return res.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await bffLogout()
    } finally {
      clearSession()
    }
  }, [clearSession])

  const refreshUser = useCallback(async () => {
    const fresh = await getMe()
    setUser(fresh)
    setStatus(statusFor(fresh))
    return fresh
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, loginWithGoogle, verifyEmail, logout, refreshUser }),
    [user, status, login, loginWithGoogle, verifyEmail, logout, refreshUser],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
