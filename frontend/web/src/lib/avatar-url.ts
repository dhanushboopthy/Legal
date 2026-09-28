// A profile picture's URL is presigned, so every response carries a fresh
// signature for the same picture. Reusing the first URL seen for a picture
// (keyed by its path, which changes only when the picture does) lets the
// browser cache it instead of fetching it again on every poll. The server's
// URLs last an hour; one is reused for 50 minutes.
const REUSE_MS = 50 * 60_000
const seen = new Map<string, { url: string; at: number }>()

export function stableAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const key = url.split('?')[0]!
  const hit = seen.get(key)
  const now = Date.now()
  if (hit && now - hit.at < REUSE_MS) return hit.url
  seen.set(key, { url, at: now })
  return url
}
