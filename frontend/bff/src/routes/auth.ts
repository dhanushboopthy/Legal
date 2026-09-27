import type { Response } from 'express'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'

import {
  BackendError,
  getMe,
  login,
  loginWithGoogle,
  logout as logoutBackend,
  refresh as refreshBackend,
  resetPassword as resetPasswordBackend,
  verifyEmail as verifyEmailBackend,
  type TokenPair,
} from '../backend-client.js'
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from '../cookies.js'

export const authRouter = Router()

// Credential attempts: the bucket that matters for brute-force resistance.
const credentialsLimiter = rateLimit({
  windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
})
// /refresh carries no credential — every open tab calls it silently on token
// expiry (and a pending-approval tab may poll faster than that). It needs
// its own, looser bucket so that traffic can never starve, or be starved by,
// actual sign-in attempts sharing the bucket above.
const refreshLimiter = rateLimit({
  windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false,
})

async function completeLogin(res: Response, tokens: TokenPair): Promise<void> {
  const user = await getMe(tokens.access_token)
  setRefreshCookie(res, tokens.refresh_token)
  res.json({ access_token: tokens.access_token, user })
}

function respondToAuthError(res: Response, err: unknown): void {
  if (err instanceof BackendError) {
    res.status(err.status).json({ detail: err.detail })
    return
  }
  res.status(502).json({ detail: 'Could not reach the backend' })
}

authRouter.post('/login', credentialsLimiter, async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string }
  if (!email || !password) {
    res.status(400).json({ detail: 'email and password are required' })
    return
  }

  try {
    await completeLogin(res, await login(email, password, req.ip))
  } catch (err) {
    respondToAuthError(res, err)
  }
})

authRouter.post('/login/google', credentialsLimiter, async (req, res) => {
  const { id_token: idToken } = req.body as { id_token?: string }
  if (!idToken) {
    res.status(400).json({ detail: 'id_token is required' })
    return
  }

  try {
    await completeLogin(res, await loginWithGoogle(idToken, req.ip))
  } catch (err) {
    respondToAuthError(res, err)
  }
})

authRouter.post('/verify-email', credentialsLimiter, async (req, res) => {
  const { email, code } = req.body as { email?: string; code?: string }
  if (!email || !code) {
    res.status(400).json({ detail: 'email and code are required' })
    return
  }

  try {
    await completeLogin(res, await verifyEmailBackend(email, code, req.ip))
  } catch (err) {
    respondToAuthError(res, err)
  }
})

authRouter.post('/reset-password', credentialsLimiter, async (req, res) => {
  const { email, code, new_password: newPassword } = req.body as {
    email?: string; code?: string; new_password?: string
  }
  if (!email || !code || !newPassword) {
    res.status(400).json({ detail: 'email, code and new_password are required' })
    return
  }

  try {
    await completeLogin(res, await resetPasswordBackend(email, code, newPassword, req.ip))
  } catch (err) {
    respondToAuthError(res, err)
  }
})

authRouter.post('/refresh', refreshLimiter, async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined
  if (!refreshToken) {
    res.status(401).json({ detail: 'No session to refresh' })
    return
  }

  try {
    await completeLogin(res, await refreshBackend(refreshToken, req.ip))
  } catch (err) {
    clearRefreshCookie(res)
    respondToAuthError(res, err)
  }
})

// Revoke the session on the api too, so a copied cookie stops working; the
// browser is signed out either way, even if the api can't be reached.
authRouter.post('/logout', async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined
  if (refreshToken) {
    await logoutBackend(refreshToken).catch((err: unknown) => {
      console.warn('logout: could not revoke session on the api', err)
    })
  }
  clearRefreshCookie(res)
  res.status(204).end()
})
