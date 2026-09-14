import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-[var(--radius-control)] bg-black/[0.06] dark:bg-white/[0.08]',
        className,
      )}
    />
  )
}
