import type { Response } from 'express'

import { config } from './config.js'

export const REFRESH_COOKIE_NAME = 'refresh_token'
// Tells nginx, which can't see the /bff-scoped refresh cookie, whether `/`
// should serve the app or the public home page. Holds no secret: forging it
// only gets you the app's sign-in screen instead of the home page.
export const SIGNED_IN_COOKIE_NAME = 'signed_in'

function secure(): boolean {
  // Only local http dev may send it unencrypted.
  return config.nodeEnv !== 'development' && config.nodeEnv !== 'test'
}

export function setRefreshCookie(res: Response, token: string): void {
  const maxAge = config.refreshTokenExpireDays * 24 * 60 * 60 * 1000
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: secure(),
    // Only our own same-origin fetches ever need it.
    sameSite: 'strict',
    path: '/bff',
    maxAge,
  })
  // Lax, not strict: it has to arrive on a top-level visit from an email or
  // bookmark, or a signed-in user would land on the home page.
  res.cookie(SIGNED_IN_COOKIE_NAME, '1', {
    httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', maxAge,
  })
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    path: '/bff', httpOnly: true, sameSite: 'strict', secure: secure(),
  })
  res.clearCookie(SIGNED_IN_COOKIE_NAME, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: secure(),
  })
}
