import { cn } from '@/lib/utils'

const TONES = [
  'bg-[var(--color-accent)]/10 text-accent-ink',
  'bg-[var(--color-success)]/10 text-success-ink',
  'bg-[var(--color-warning)]/10 text-warning-ink',
  'bg-black/[0.06] text-[var(--fg)]',
]

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words[0]?.[0] ?? '?').concat(words[1]?.[0] ?? '').toUpperCase()
}

// Same name, same colour, so a conversation is recognisable at a glance.
function toneFor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return TONES[hash % TONES.length]!
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
        toneFor(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
