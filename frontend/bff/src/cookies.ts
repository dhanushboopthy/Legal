import type { Response } from 'express'

import { config } from './config.js'

export const REFRESH_COOKIE_NAME = 'refresh_token'

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/bff',
    maxAge: config.refreshTokenExpireDays * 24 * 60 * 60 * 1000,
  })
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/bff' })
}
