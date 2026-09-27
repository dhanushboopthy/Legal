import * as RadixToast from '@radix-ui/react-toast'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'

import { ToastContext, type ToastItem } from '@/components/ui/toast-context'
import { cn } from '@/lib/utils'

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const toast = useCallback((item: Omit<ToastItem, 'id'>) => {
    setItems((prev) => [...prev, { ...item, id: Date.now() + Math.random() }])
  }, [])

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext value={{ toast }}>
      <RadixToast.Provider swipeDirection="right">
        {children}
        {items.map((item) => (
          <RadixToast.Root
            key={item.id}
            // Success notes stay long enough to read slowly; errors stay until
            // dismissed, so nobody misses what went wrong.
            duration={item.variant === 'success' ? 8000 : Infinity}
            onOpenChange={(open) => {
              if (!open) remove(item.id)
            }}
            className={cn(
              'surface shadow-overlay flex items-start gap-3 rounded-[var(--radius-control)] border border-[var(--border)] p-4 pr-5 data-[state=open]:animate-[toast-in_180ms_ease-out] data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]',
            )}
          >
            {item.variant === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--color-success)]" />
            ) : (
              <XCircle className="mt-0.5 size-5 shrink-0 text-[var(--color-danger)]" />
            )}
            <div className="min-w-0 flex-1">
              <RadixToast.Title className="text-sm font-semibold">{item.title}</RadixToast.Title>
              {item.description && (
                <RadixToast.Description className="text-muted mt-1 text-sm">
                  {item.description}
                </RadixToast.Description>
              )}
            </div>
            <RadixToast.Close className="min-h-11 shrink-0 rounded-full border border-[var(--border-strong)] px-4 text-sm font-semibold hover:bg-black/[0.05]">
              Dismiss
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed right-0 bottom-0 z-50 flex w-[28rem] max-w-[100vw] flex-col gap-2 p-4 outline-none" />
      </RadixToast.Provider>
    </ToastContext>
  )
}
