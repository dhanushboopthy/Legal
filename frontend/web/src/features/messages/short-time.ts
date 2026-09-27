const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// How long ago, the way a messaging inbox says it: "now", "5m", "3h", "2d",
// then a date ("12 Sept", or "12 Sept 2025" in another year).
export function shortTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const ago = now.getTime() - then.getTime()
  if (ago < MINUTE) return 'now'
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m`
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h`
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)}d`
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(then)
}
