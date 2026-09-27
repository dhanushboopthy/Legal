import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

// A panel for secondary detail (files, case details): slides up from the
// bottom on a phone, sits at the right edge from `sm` up. Same Radix dialog
// underneath, so focus is trapped, Esc closes, and focus returns on close.
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <RadixDialog.Content className="surface shadow-card fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-[var(--radius-card)] focus:outline-none sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[32rem] sm:rounded-t-none sm:rounded-l-[var(--radius-card)]">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-4">
            <div>
              <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="text-muted mt-1 text-sm">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-4 text-sm font-semibold transition-colors hover:bg-black/[0.05]"
            >
              <X className="size-5" aria-hidden />
              Close
            </RadixDialog.Close>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
