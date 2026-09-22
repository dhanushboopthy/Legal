import type { ReactNode } from 'react'

import { splitLinks } from '@/features/chat/split-links'

export function LinkifiedText({ text }: { text: string }): ReactNode {
  return splitLinks(text).map((part, i) =>
    part.href ? (
      <a
        key={i}
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all underline underline-offset-2"
      >
        {part.text}
      </a>
    ) : (
      <span key={i}>{part.text}</span>
    ),
  )
}
