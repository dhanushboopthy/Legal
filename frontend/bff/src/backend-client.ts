import { config } from './config.js'

export interface UserOut {
  id: string
  full_name: string
  email: string
  phone: string | null
  bar_council_id: string | null
  role_name: string
  permissions: string[]
  is_active: boolean
  is_verified: boolean
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
}

export class BackendError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail)
  }
}

// The api keys its sign-in rate limits by X-Real-IP; without passing it on,
// every browser would share the BFF container's address and one bucket.
function forwardedFor(clientIp: string | undefined): Record<string, string> {
  return clientIp ? { 'X-Real-IP': clientIp } : {}
}

async function backendFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${config.backendUrl}${path}`, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ detail: res.statusText }))) as { detail?: string }
    throw new BackendError(res.status, body.detail ?? 'Request to backend failed')
  }
  return (await res.json()) as T
}

export async function login(email: string, password: string, clientIp?: string): Promise<TokenPair> {
  return backendFetch<TokenPair>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...forwardedFor(clientIp) },
    body: new URLSearchParams({ username: email, password }),
  })
}

export async function loginWithGoogle(idToken: string, clientIp?: string): Promise<TokenPair> {
  return backendFetch<TokenPair>('/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...forwardedFor(clientIp) },
    body: JSON.stringify({ id_token: idToken }),
  })
}

// Verifying is enough for a token (see app.routers.auth._require_verified) —
// this is how a freshly-verified account gets a session with no separate
// login step, pending or not.
export async function verifyEmail(email: string, code: string, clientIp?: string): Promise<TokenPair> {
  return backendFetch<TokenPair>('/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...forwardedFor(clientIp) },
    body: JSON.stringify({ email, code }),
  })
}

export async function refresh(refreshToken: string, clientIp?: string): Promise<TokenPair> {
  return backendFetch<TokenPair>('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...forwardedFor(clientIp) },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
}

export async function resetPassword(
  email: string, code: string, newPassword: string, clientIp?: string,
): Promise<TokenPair> {
  return backendFetch<TokenPair>('/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...forwardedFor(clientIp) },
    body: JSON.stringify({ email, code, new_password: newPassword }),
  })
}

export async function logout(refreshToken: string): Promise<void> {
  const res = await fetch(`${config.backendUrl}/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  if (!res.ok) throw new BackendError(res.status, 'Sign-out failed')
}

export async function getMe(accessToken: string): Promise<UserOut> {
  return backendFetch<UserOut>('/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
