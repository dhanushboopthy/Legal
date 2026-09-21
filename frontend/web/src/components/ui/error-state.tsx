import { TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { StatusPage } from '@/components/ui/status-page'
import { getErrorMessage } from '@/lib/errors'

// A block of a page whose data failed to load. Use this instead of EmptyState
// on a failed request: "No cases yet" for a request that errored is a lie.
export function ErrorState({
  error,
  title = "Couldn't load this",
  onRetry,
}: {
  error?: unknown
  title?: string
  onRetry?: () => void
}) {
  return (
    <div role="alert">
      <StatusPage
        compact
        icon={TriangleAlert}
        title={title}
        description={getErrorMessage(error, 'Something went wrong on our side. Please try again.')}
        actions={onRetry && <Button onClick={onRetry}>Try again</Button>}
      />
    </div>
  )
}
