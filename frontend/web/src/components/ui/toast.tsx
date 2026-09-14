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
            duration={4000}
            onOpenChange={(open) => {
              if (!open) remove(item.id)
            }}
            className={cn(
              'surface shadow-card flex items-start gap-3 rounded-[var(--radius-control)] border border-[var(--border)] p-4 pr-5 data-[state=open]:animate-[toast-in_180ms_ease-out] data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]',
            )}
          >
            {item.variant === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--color-success)]" />
            ) : (
              <XCircle className="mt-0.5 size-5 shrink-0 text-[var(--color-danger)]" />
            )}
            <div>
              <RadixToast.Title className="text-sm font-medium">{item.title}</RadixToast.Title>
              {item.description && (
                <RadixToast.Description className="text-muted mt-0.5 text-[13px]">
                  {item.description}
                </RadixToast.Description>
              )}
            </div>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed right-0 bottom-0 z-50 flex w-96 max-w-[100vw] flex-col gap-2 p-4 outline-none" />
      </RadixToast.Provider>
    </ToastContext>
  )
}
