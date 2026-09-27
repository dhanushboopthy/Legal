import { Download, FileText, Lock } from 'lucide-react'

import { List, ListRow } from '@/components/ui/list'
import { Sheet } from '@/components/ui/sheet'
import { PaymentStatusPill } from '@/components/ui/status-pill'
import { useToast } from '@/components/ui/toast-context'
import { openDocument } from '@/lib/download'
import { getErrorMessage } from '@/lib/errors'
import { formatBytes } from '@/lib/uploads'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { CaseOut, DocumentOut, PaymentOut } from '@/types/api'

/** Everything about a case that isn't the next step: its details, every file
 * (what was submitted and every draft version) and its payments. */
export function CaseDetailsSheet({
  open,
  onOpenChange,
  caseData,
  documents,
  payments,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  caseData: CaseOut
  documents: DocumentOut[]
  payments: PaymentOut[]
}) {
  const submitted = documents.filter((d) => d.type !== 'draft')
  const drafts = documents.filter((d) => d.type === 'draft').toReversed()

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Case details" description={caseData.title}>
      <div className="space-y-8">
        <List heading="Details">
          {caseData.case_number && <ListRow title="Case number" trailing={caseData.case_number} />}
          <ListRow title="Case type" trailing={caseData.case_type} />
          {caseData.court && <ListRow title="Court" trailing={caseData.court} />}
          <ListRow title="Filed" trailing={formatDate(caseData.created_at)} />
          {caseData.description && (
            <ListRow title="Description" subtitle={<span className="whitespace-pre-wrap">{caseData.description}</span>} />
          )}
          {caseData.note && (
            <ListRow title="Note to the advocate" subtitle={<span className="whitespace-pre-wrap">{caseData.note}</span>} />
          )}
        </List>

        {drafts.length > 0 && (
          <List heading="Drafts" footnote={drafts.some((d) => d.locked) ? 'A draft opens once its price is paid.' : undefined}>
            {drafts.map((doc, i) => (
              <FileRow key={doc.id} doc={doc} label={`Version ${doc.version}${i === 0 ? ' (latest)' : ''}`} />
            ))}
          </List>
        )}

        <List heading="Submitted files">
          {submitted.length === 0 ? (
            <ListRow title={<span className="text-muted">No files yet</span>} />
          ) : (
            submitted.map((doc) => <FileRow key={doc.id} doc={doc} />)
          )}
        </List>

        <List heading="Payments">
          {payments.length === 0 ? (
            <ListRow title={<span className="text-muted">No payments yet</span>} />
          ) : (
            payments.map((p) => (
              <ListRow
                key={p.id}
                title={p.type === 'review' ? 'Review fee' : 'Draft'}
                subtitle={p.paid_at ? formatDate(p.paid_at) : undefined}
                trailing={
                  <>
                    <span className="text-sm tabular-nums">{formatCurrency(p.amount)}</span>
                    <PaymentStatusPill status={p.status} />
                  </>
                }
              />
            ))
          )}
        </List>
      </div>
    </Sheet>
  )
}

function FileRow({ doc, label }: { doc: DocumentOut; label?: string }) {
  const { toast } = useToast()
  const meta = [
    label && doc.original_filename,
    doc.page_count ? `${doc.page_count} pages` : null,
    doc.size_bytes !== null ? formatBytes(doc.size_bytes) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  if (doc.locked) {
    return (
      <ListRow
        icon={Lock}
        title={label ?? doc.original_filename}
        subtitle={meta || undefined}
        trailing={<span className="text-muted text-label">Locked</span>}
      />
    )
  }
  return (
    <ListRow
      icon={FileText}
      title={label ?? doc.original_filename}
      subtitle={meta || undefined}
      trailing={
        <span className="text-accent-ink inline-flex items-center gap-1.5 text-sm font-medium">
          <Download className="size-5" aria-hidden /> Download
        </span>
      }
      chevron={false}
      onClick={async () => {
        try {
          await openDocument(doc.id)
        } catch (err) {
          toast({ variant: 'error', title: 'Could not open the file', description: getErrorMessage(err) })
        }
      }}
    />
  )
}
