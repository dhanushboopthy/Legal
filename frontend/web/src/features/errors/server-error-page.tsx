import { TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { StatusPage } from '@/components/ui/status-page'

// Shown by the ErrorBoundary (a render crash) and for failed page-level
// queries. `onRetry` re-attempts in place; without it the page reloads.
export function ServerErrorPage({
  inline = false,
  onRetry,
}: {
  inline?: boolean
  onRetry?: () => void
}) {
  return (
    <StatusPage
      inline={inline}
      icon={TriangleAlert}
      title="Something went wrong"
      description="We hit an unexpected problem. Your data is safe — please try again, and if it keeps happening, let us know."
      actions={
        <>
          <Button onClick={onRetry ?? (() => window.location.reload())}>Try again</Button>
          <Button variant="secondary" onClick={() => window.location.assign('/')}>
            Go to dashboard
          </Button>
        </>
      }
    />
  )
}
