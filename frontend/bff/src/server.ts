import 'dotenv/config'

import cookieParser from 'cookie-parser'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'

import { config } from './config.js'
import { authRouter } from './routes/auth.js'

export const app = express()

app.disable('x-powered-by')
app.use(helmet())
app.use(express.json())
app.use(cookieParser())

// This service only ever brokers auth for its own SPA on the same origin
// (nginx/Vite proxy /bff -> here), so a same-origin-only CORS posture (i.e.
// no CORS headers at all) is intentional, not an oversight.

app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
  }),
)

app.get('/health', (_req, res) => res.json({ status: 'ok' }))
app.use('/', authRouter)

if (process.env.VITEST !== 'true') {
  app.listen(config.port, () => {
    console.log(`bff listening on :${config.port}`)
  })
}
