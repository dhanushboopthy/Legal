import { Sheet } from '@/components/ui/sheet'
import { PaymentStatusPill } from '@/components/ui/status-pill'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { CaseOut, PaymentOut } from '@/types/api'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted text-caption font-medium">{label}</p>
      <p className="mt-0.5 text-sm whitespace-pre-wrap">{value}</p>
    </div>
  )
}

export function DetailsSheet({
  open,
  onOpenChange,
  caseData,
  payments,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  caseData: CaseOut
  payments: PaymentOut[]
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Details" description={caseData.title}>
      <div className="space-y-4">
        <Row label="Case type" value={caseData.case_type} />
        {caseData.court && <Row label="Court" value={caseData.court} />}
        {caseData.description && <Row label="Description" value={caseData.description} />}
        {caseData.note && <Row label="Note to the advocate" value={caseData.note} />}
        <Row label="Filed" value={formatDate(caseData.created_at)} />

        <div>
          <p className="text-muted text-caption mb-2 font-medium">Payments</p>
          {payments.length === 0 ? (
            <p className="text-muted text-label">No payments yet.</p>
          ) : (
            <ul className="space-y-2">
              {payments.map((p) => (
                <li key={p.id} className="text-label flex items-center justify-between">
                  <span className="capitalize">{p.type} fee</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted">{formatCurrency(p.amount)}</span>
                    <PaymentStatusPill status={p.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  )
}
