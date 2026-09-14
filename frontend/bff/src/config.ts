const required = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  backendUrl: required('BACKEND_URL', 'http://localhost:8000'),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  // The refresh cookie has no reason to live longer than the backend's own
  // refresh token TTL; keep them in step rather than guessing a duration.
  refreshTokenExpireDays: Number(process.env.REFRESH_TOKEN_EXPIRE_DAYS ?? 7),
}
