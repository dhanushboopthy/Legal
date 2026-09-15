import type { Response } from 'express'
import { Router } from 'express'

import {
  BackendError,
  getMe,
  login,
  loginWithGoogle,
  refresh as refreshBackend,
  type TokenPair,
} from '../backend-client.js'
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from '../cookies.js'

export const authRouter = Router()

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

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string }
  if (!email || !password) {
    res.status(400).json({ detail: 'email and password are required' })
    return
  }

  try {
    await completeLogin(res, await login(email, password))
  } catch (err) {
    respondToAuthError(res, err)
  }
})

authRouter.post('/login/google', async (req, res) => {
  const { id_token: idToken } = req.body as { id_token?: string }
  if (!idToken) {
    res.status(400).json({ detail: 'id_token is required' })
    return
  }

  try {
    await completeLogin(res, await loginWithGoogle(idToken))
  } catch (err) {
    respondToAuthError(res, err)
  }
})

authRouter.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined
  if (!refreshToken) {
    res.status(401).json({ detail: 'No session to refresh' })
    return
  }

  try {
    await completeLogin(res, await refreshBackend(refreshToken))
  } catch (err) {
    clearRefreshCookie(res)
    respondToAuthError(res, err)
  }
})

authRouter.post('/logout', (_req, res) => {
  clearRefreshCookie(res)
  res.status(204).end()
})
