// A tiny module-level store for the in-memory access token, deliberately
// outside React state so axios interceptors (which live outside the React
// tree) can read/write it without a dependency cycle on AuthContext. The
// refresh token itself never touches this app — it lives only in the BFF's
// httpOnly cookie.

type Listener = (token: string | null) => void

let currentToken: string | null = null
const listeners = new Set<Listener>()

export function getAccessToken(): string | null {
  return currentToken
}

export function setAccessToken(token: string | null): void {
  currentToken = token
  for (const listener of listeners) listener(token)
}

export function subscribeToAccessToken(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
