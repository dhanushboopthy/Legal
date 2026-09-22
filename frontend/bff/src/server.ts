import 'dotenv/config'

import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'

import { authRouter } from './routes/auth.js'
import { config } from './config.js'

export const app = express()

app.disable('x-powered-by')
app.use(helmet())
app.use(express.json())
app.use(cookieParser())

// This service only ever brokers auth for its own SPA on the same origin
// (nginx/Vite proxy /bff -> here), so a same-origin-only CORS posture (i.e.
// no CORS headers at all) is intentional, not an oversight.

// Rate limits live per-route in routes/auth.ts — /refresh gets its own,
// looser bucket there (see the comment on refreshLimiter) so a page quietly
// refreshing its session can't be starved by, or starve, login attempts.

app.get('/health', (_req, res) => res.json({ status: 'ok' }))
app.use('/', authRouter)

if (process.env.VITEST !== 'true') {
  app.listen(config.port, () => {
    console.log(`bff listening on :${config.port}`)
  })
}
