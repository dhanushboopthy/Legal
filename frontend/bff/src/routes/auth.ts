import { Router } from 'express'

import { BackendError, getMe, login, refresh as refreshBackend } from '../backend-client.js'
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from '../cookies.js'

export const authRouter = Router()

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string }
  if (!email || !password) {
    res.status(400).json({ detail: 'email and password are required' })
    return
  }

  try {
    const tokens = await login(email, password)
    const user = await getMe(tokens.access_token)
    setRefreshCookie(res, tokens.refresh_token)
    res.json({ access_token: tokens.access_token, user })
  } catch (err) {
    if (err instanceof BackendError) {
      res.status(err.status).json({ detail: err.detail })
      return
    }
    res.status(502).json({ detail: 'Could not reach the backend' })
  }
})

authRouter.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined
  if (!refreshToken) {
    res.status(401).json({ detail: 'No session to refresh' })
    return
  }

  try {
    const tokens = await refreshBackend(refreshToken)
    const user = await getMe(tokens.access_token)
    setRefreshCookie(res, tokens.refresh_token)
    res.json({ access_token: tokens.access_token, user })
  } catch (err) {
    clearRefreshCookie(res)
    if (err instanceof BackendError) {
      res.status(err.status).json({ detail: err.detail })
      return
    }
    res.status(502).json({ detail: 'Could not reach the backend' })
  }
})

authRouter.post('/logout', (_req, res) => {
  clearRefreshCookie(res)
  res.status(204).end()
})
