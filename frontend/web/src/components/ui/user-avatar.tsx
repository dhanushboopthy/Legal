import { useState } from 'react'

import { stableAvatarUrl } from '@/lib/avatar-url'
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

// Same name, same colour, so a person is recognisable at a glance.
function toneFor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return TONES[hash % TONES.length]!
}

/** A person's profile picture, or their initials when they have none (or it
 * fails to load). Decorative: the name is always written next to it. */
export function UserAvatar({
  name,
  src,
  className,
}: {
  name: string
  src?: string | null
  className?: string
}) {
  const url = stableAvatarUrl(src)
  const [failed, setFailed] = useState<string | null>(null)
  const base = cn(
    'inline-flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold',
    className,
  )

  if (url && failed !== url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden
        className={cn(base, 'bg-black/[0.06] object-cover')}
        onError={() => setFailed(url)}
      />
    )
  }
  return (
    <span aria-hidden className={cn(base, toneFor(name))}>
      {initials(name)}
    </span>
  )
}
