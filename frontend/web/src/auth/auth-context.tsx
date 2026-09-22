import { createContext, useContext } from 'react'

import type { UserOut } from '@/types/api'

export interface AuthContextValue {
  user: UserOut | null
  // 'pending': a verified account waiting on admin approval. It holds a real
  // session (so GET /users/me works, for the pending-approval screen's poll)
  // but every permission-gated route and action stays blocked, same as
  // 'unauthenticated' would be.
  status: 'loading' | 'authenticated' | 'pending' | 'unauthenticated'
  // Both resolve with the signed-in user so the caller can route on
  // user.is_active immediately, without waiting for a context re-render.
  login: (email: string, password: string) => Promise<UserOut>
  loginWithGoogle: (idToken: string) => Promise<UserOut>
  // Verifying the OTP is itself enough for a session (see the backend's
  // _require_verified) — this is how a fresh account lands on
  // pending-approval, or straight on Cases, with no separate login step.
  verifyEmail: (email: string, code: string) => Promise<UserOut>
  logout: () => Promise<void>
  // Re-fetches /users/me and updates user/status from it — how a 'pending'
  // session notices it was approved without a full page reload.
  refreshUser: () => Promise<UserOut>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
