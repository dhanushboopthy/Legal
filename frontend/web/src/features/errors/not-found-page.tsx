import { Compass } from 'lucide-react'
import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button-variants'

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-black/[0.04]">
        <Compass className="size-7 text-[var(--fg-muted)]" strokeWidth={1.5} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted max-w-sm text-sm">
        The page you're looking for doesn't exist or may have moved.
      </p>
      <Link to="/" className={buttonVariants({ variant: 'primary', size: 'md' })}>
        Back to dashboard
      </Link>
    </div>
  )
}
