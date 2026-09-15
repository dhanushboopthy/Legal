import { config } from './config.js'

export interface UserOut {
  id: string
  full_name: string
  email: string
  phone: string | null
  bar_council_id: string | null
  role_name: string
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

async function backendFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${config.backendUrl}${path}`, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ detail: res.statusText }))) as { detail?: string }
    throw new BackendError(res.status, body.detail ?? 'Request to backend failed')
  }
  return (await res.json()) as T
}

export async function login(email: string, password: string): Promise<TokenPair> {
  return backendFetch<TokenPair>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: email, password }),
  })
}

export async function loginWithGoogle(idToken: string): Promise<TokenPair> {
  return backendFetch<TokenPair>('/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  })
}

export async function refresh(refreshToken: string): Promise<TokenPair> {
  return backendFetch<TokenPair>('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
}

export async function getMe(accessToken: string): Promise<UserOut> {
  return backendFetch<UserOut>('/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
