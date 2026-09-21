import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, Download, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Label, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast-context'
import { getErrorMessage } from '@/lib/errors'
import { approveCase, requestRevision } from '@/lib/api/cases'
import { getDownloadUrl, listCaseDocuments } from '@/lib/api/documents'

export function DraftReviewPanel({ caseId, onChanged }: { caseId: string; onChanged: () => void }) {
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: documents } = useQuery({
    queryKey: ['case-documents', caseId],
    queryFn: () => listCaseDocuments(caseId),
  })
  const latestDraft = documents?.filter((d) => d.type === 'draft').at(-1)

  const download = useMutation({
    mutationFn: () => getDownloadUrl(latestDraft!.id),
    onSuccess: (url) => window.open(url, '_blank'),
    onError: (err) =>
      toast({
        variant: 'error',
        title: 'Could not get download link',
        description: getErrorMessage(err),
      }),
  })

  const approve = useMutation({
    mutationFn: () => approveCase(caseId),
    onSuccess: () => {
      toast({ variant: 'success', title: 'Case approved', description: 'Your filing is complete.' })
      onChanged()
    },
    onError: (err) =>
      toast({
        variant: 'error',
        title: 'Could not approve case',
        description: getErrorMessage(err),
      }),
  })

  const revise = useMutation({
    mutationFn: () => requestRevision(caseId, reason),
    onSuccess: () => {
      setDialogOpen(false)
      toast({ variant: 'success', title: 'Changes requested' })
      onChanged()
    },
    onError: (err) =>
      toast({
        variant: 'error',
        title: 'Could not request changes',
        description: getErrorMessage(err),
      }),
  })

  return (
    <Card>
      <h3 className="mb-1 font-semibold">Your draft is ready</h3>
      <p className="text-muted mb-4 text-sm">
        Review the draft filing, then approve it or request changes.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          loading={download.isPending}
          disabled={!latestDraft}
          onClick={() => download.mutate()}
        >
          <Download className="size-4" /> Download draft
        </Button>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary">
              <RotateCcw className="size-4" /> Request changes
            </Button>
          </DialogTrigger>
          <DialogContent
            title="Request changes"
            description="Tell the advocate what needs to change."
          >
            <Label htmlFor="revision-reason">What needs to change?</Label>
            <Textarea
              id="revision-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the changes you'd like"
            />
            <Button
              className="mt-4 w-full"
              disabled={reason.trim().length < 5}
              loading={revise.isPending}
              onClick={() => revise.mutate()}
            >
              Submit request
            </Button>
          </DialogContent>
        </Dialog>

        <Button loading={approve.isPending} onClick={() => approve.mutate()}>
          <CheckCircle2 className="size-4" /> Approve filing
        </Button>
      </div>
    </Card>
  )
}
