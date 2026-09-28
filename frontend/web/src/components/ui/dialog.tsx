import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger

export function DialogContent({
  children,
  title,
  description,
  className,
}: {
  children: ReactNode
  title: string
  description?: string
  className?: string
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
      <RadixDialog.Content
        className={cn(
          'surface shadow-overlay fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-sheet)] p-6 focus:outline-none',
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="text-muted mt-1 text-sm">
                {description}
              </RadixDialog.Description>
            )}
          </div>
          <RadixDialog.Close
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-4 text-sm font-semibold transition-colors hover:bg-ink/[0.05]"
          >
            <X className="size-5" aria-hidden />
            Close
          </RadixDialog.Close>
        </div>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}
