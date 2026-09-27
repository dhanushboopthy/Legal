const MINUTE = 60_000
const HOUR = 60 * MINUTE

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// When, in plain words rather than texting shorthand: "Just now", "5 min ago",
// "Today, 3:05 pm", "Yesterday", then a date ("12 Sept", or "12 Sept 2025" in
// another year).
export function shortTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const ago = now.getTime() - then.getTime()
  if (ago < MINUTE) return 'Just now'
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`
  if (sameDay(then, now)) {
    const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(then)
    return `Today, ${time}`
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(then, yesterday)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(then)
}
