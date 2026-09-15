import * as RadixDropdown from '@radix-ui/react-dropdown-menu'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export const DropdownMenu = RadixDropdown.Root
export const DropdownMenuTrigger = RadixDropdown.Trigger

export function DropdownMenuContent({
  children,
  align = 'end',
  className,
}: {
  children: ReactNode
  align?: 'start' | 'end' | 'center'
  className?: string
}) {
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.Content
        align={align}
        sideOffset={8}
        className={cn(
          'surface shadow-card z-50 min-w-56 rounded-[var(--radius-control)] border border-[var(--border)] p-1.5',
          className,
        )}
      >
        {children}
      </RadixDropdown.Content>
    </RadixDropdown.Portal>
  )
}

export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof RadixDropdown.Item>) {
  return (
    <RadixDropdown.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-[calc(var(--radius-control)-0.25rem)] px-2.5 py-2 text-sm transition-colors outline-none data-[highlighted]:bg-black/[0.05]',
        className,
      )}
      {...props}
    />
  )
}

export const DropdownMenuSeparator = () => (
  <RadixDropdown.Separator className="my-1.5 h-px bg-[var(--border)]" />
)
