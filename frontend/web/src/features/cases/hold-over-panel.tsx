import { useMutation } from '@tanstack/react-query'
import { PauseCircle } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast-context'
import { InfoPanel } from '@/features/cases/info-panel'
import { holdCase, resumeCase } from '@/lib/api/cases'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

// Common reasons are one tap; "Another reason" needs a note.
const REASONS = [
  'Awaiting the court date',
  'Waiting for documents',
  'Matter adjourned',
  'Another reason',
] as const
type Reason = (typeof REASONS)[number]

/** For the advocate, under the action card while the case is waiting on them:
 * a quiet "Hold over" that opens into a reason and one confirmation. */
export function HoldOverControl({ caseId, onChanged }: { caseId: string; onChanged: () => void }) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<Reason | null>(null)
  const [note, setNote] = useState('')

  const text =
    reason === 'Another reason' ? note.trim() : [reason, note.trim()].filter(Boolean).join('. ')
  const ready = reason !== null && text.length >= 3

  const hold = useMutation({
    mutationFn: () => holdCase(caseId, text),
    onSuccess: () => {
      toast({
        variant: 'success',
        title: 'Case held over',
        description: 'The lawyer has been told, with your reason.',
      })
      setOpen(false)
      onChanged()
    },
    onError: (err) =>
      toast({
        variant: 'error',
        title: 'Could not hold the case over',
        description: getErrorMessage(err),
      }),
  })

  if (!open) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-2 px-1">
        <span className="text-muted text-sm">Need to pause this case?</span>
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setOpen(true)}>
          <PauseCircle className="size-4" aria-hidden /> Hold over
        </Button>
      </div>
    )
  }

  return (
    <Card className="mt-3">
      <fieldset>
        <legend className="font-semibold">Hold this case over</legend>
        <p className="text-muted mt-0.5 text-sm">
          The case pauses until you resume it. The lawyer sees your reason, and the chat stays open.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
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
          <Label htmlFor="hold_note">
            {reason === 'Another reason' ? 'Your reason' : 'Note for the lawyer (optional)'}
          </Label>
          <Textarea
            id="hold_note"
            value={note}
            maxLength={400}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For example, the next hearing date"
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button loading={hold.isPending} disabled={!ready} onClick={() => hold.mutate()}>
            Hold over case
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </Card>
  )
}

/** The action card while a case is held over: the reason for everyone, and
 * "Resume work" for whoever may resume it. */
export function HeldOverPanel({
  caseId,
  reason,
  canResume,
  onChanged,
}: {
  caseId: string
  reason: string | null
  canResume: boolean
  onChanged: () => void
}) {
  const { toast } = useToast()
  const why = reason?.replace(/\.$/, '') ?? 'no reason given'
  const resume = useMutation({
    mutationFn: () => resumeCase(caseId),
    onSuccess: () => {
      toast({ variant: 'success', title: 'Work resumed', description: 'The lawyer has been told.' })
      onChanged()
    },
    onError: (err) =>
      toast({
        variant: 'error',
        title: 'Could not resume the case',
        description: getErrorMessage(err),
      }),
  })

  return (
    <InfoPanel
      icon={PauseCircle}
      title="Held over"
      description={
        canResume
          ? `You held this case over: ${why}.`
          : `The advocate has held this case over: ${why}. Work resumes when they are ready; you can still message them.`
      }
      action={
        canResume && (
          <Button className="mt-4" loading={resume.isPending} onClick={() => resume.mutate()}>
            Resume work
          </Button>
        )
      }
    />
  )
}
