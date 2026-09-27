import type { NextFunction, Request, Response } from 'express'

// Browsers send Origin on every cross-site POST, so a form or script on
// another site trying to sign someone in (login CSRF) or refresh their session
// is refused here. Requests without Origin aren't from a browser page and
// can't carry the victim's cookie, so they pass. EXTRA_ALLOWED_ORIGINS covers
// a deployment where the SPA is served from a different host than the BFF.
const extraAllowed = new Set(
  (process.env.EXTRA_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
)

export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next()
    return
  }
  const origin = req.get('origin')
  if (!origin || extraAllowed.has(origin)) {
    next()
    return
  }
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    hostname = ''
  }
  if (hostname && hostname === req.hostname) {
    next()
    return
  }
  res.status(403).json({ detail: 'Request refused: it did not come from this site.' })
}
