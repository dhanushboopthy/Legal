import * as RadixPopover from '@radix-ui/react-popover'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export const Popover = RadixPopover.Root
export const PopoverTrigger = RadixPopover.Trigger

export function PopoverContent({
  children,
  align = 'end',
  className,
  label,
}: {
  children: ReactNode
  align?: 'start' | 'end' | 'center'
  className?: string
  /** Names the panel for screen readers. */
  label: string
}) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        sideOffset={8}
        collisionPadding={12}
        aria-label={label}
        className={cn(
          'surface shadow-overlay z-50 rounded-[var(--radius-sheet)] border border-[var(--border)]',
          className,
        )}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  )
}
