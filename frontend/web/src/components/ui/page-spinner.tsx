import { Loader2 } from 'lucide-react'

export function PageSpinner() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-[var(--fg-muted)]" />
    </div>
  )
}
