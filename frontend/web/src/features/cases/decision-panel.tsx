import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast-context'
import { decideCase } from '@/lib/api/cases'

export function DecisionPanel({ caseId, onDecided }: { caseId: string; onDecided: () => void }) {
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const [showReject, setShowReject] = useState(false)

  const { mutate, isPending, variables } = useMutation({
    mutationFn: (accept: boolean) => decideCase(caseId, { accept, rejection_reason: reason }),
    onSuccess: (_, accept) => {
      toast({
        variant: 'success',
        title: accept ? 'Case accepted' : 'Case rejected',
        description: accept
          ? 'The junior lawyer can now pay the drafting fee.'
          : 'The junior lawyer has been notified.',
      })
      onDecided()
    },
    onError: () => toast({ variant: 'error', title: 'Could not save decision' }),
  })

  return (
    <Card>
      <h3 className="mb-1 font-semibold">Review this case</h3>
      <p className="text-muted mb-4 text-sm">
        Accept to request the drafting fee, or reject with a reason.
      </p>

      {showReject && (
        <div className="mb-4">
          <Label htmlFor="rejection_reason">Reason for rejection</Label>
          <Textarea
            id="rejection_reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this case isn't being accepted"
          />
        </div>
      )}

      <div className="flex gap-2">
        <Button loading={isPending && variables === true} onClick={() => mutate(true)}>
          Accept case
        </Button>
        {showReject ? (
          <Button
            variant="danger"
            loading={isPending && variables === false}
            disabled={reason.trim().length === 0}
            onClick={() => mutate(false)}
          >
            Confirm rejection
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setShowReject(true)}>
            Reject case
          </Button>
        )}
      </div>
    </Card>
  )
}
