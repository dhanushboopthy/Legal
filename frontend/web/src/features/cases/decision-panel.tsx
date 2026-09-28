import { useMutation } from '@tanstack/react-query'
import { Scale } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast-context'
import { getErrorMessage } from '@/lib/errors'
import { decideCase } from '@/lib/api/cases'
import { cn } from '@/lib/utils'

// Common reasons are one tap (docs/NEW_FLOW_SPEC.md); a note is optional,
// except for "Another reason", which needs one.
const REASONS = [
  'Outside my practice area',
  'Not enough information to proceed',
  'Conflict of interest',
  'Another reason',
] as const
type Reason = (typeof REASONS)[number]

export function DecisionPanel({ caseId, onDecided }: { caseId: string; onDecided: () => void }) {
  const { toast } = useToast()
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState<Reason | null>(null)
  const [note, setNote] = useState('')

  const rejectionReason =
    reason === 'Another reason' ? note.trim() : [reason, note.trim()].filter(Boolean).join('. ')
  const canDecline = reason !== null && (reason !== 'Another reason' || note.trim().length > 0)

  const { mutate, isPending, variables } = useMutation({
    mutationFn: (accept: boolean) =>
      decideCase(caseId, { accept, rejection_reason: accept ? '' : rejectionReason }),
    onSuccess: (_, accept) => {
      toast({
        variant: 'success',
        title: accept ? 'Case accepted' : 'Case deferred',
        description: accept
          ? 'The lawyer has been told you will send a draft and the drafting charges.'
          : 'The lawyer has been told, with your reason.',
      })
      onDecided()
    },
    onError: (err) =>
      toast({
        variant: 'error',
        title: 'Could not save decision',
        description: getErrorMessage(err),
      }),
  })

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className="hidden size-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent-ink)] sm:flex">
          <Scale className="size-5" strokeWidth={1.75} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Will you take this case?</h3>
          <p className="text-muted mt-0.5 text-sm">
            The review fee is paid. Read the files and details, then accept or defer.
          </p>

          {!declining ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button loading={isPending && variables === true} onClick={() => mutate(true)}>
                Accept case
              </Button>
              <Button variant="secondary" onClick={() => setDeclining(true)}>
                Defer
              </Button>
            </div>
          ) : (
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm font-medium">Why are you deferring it?</legend>
              <div className="flex flex-wrap gap-2">
                {REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={reason === r}
                    onClick={() => setReason(r)}
                    className={cn(
                      'min-h-11 rounded-full px-4 text-sm font-medium transition-colors',
                      reason === r
                        ? 'bg-[var(--fg)] text-white'
                        : 'bg-black/[0.06] text-[var(--fg)] hover:bg-black/[0.1]',
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <div className="mt-4">
                <Label htmlFor="rejection_note">
                  {reason === 'Another reason' ? 'Your reason' : 'Note for the lawyer (optional)'}
                </Label>
                <Textarea
                  id="rejection_note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="The lawyer sees this with your decision"
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  loading={isPending && variables === false}
                  disabled={!canDecline}
                  onClick={() => mutate(false)}
                >
                  Defer case
                </Button>
                <Button variant="ghost" onClick={() => setDeclining(false)}>
                  Cancel
                </Button>
              </div>
            </fieldset>
          )}
        </div>
      </div>
    </Card>
  )
}
