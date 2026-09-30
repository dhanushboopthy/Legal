import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'

import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dropzone, FileRow } from '@/components/ui/dropzone'
import { ErrorState } from '@/components/ui/error-state'
import { Field, FieldError, Input, Select, Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast-context'
import { CASE_TYPES } from '@/features/cases/case-types'
import { useCaseSubmission } from '@/features/cases/use-case-submission'
import { useRazorpayCheckout } from '@/hooks/use-razorpay'
import { createReviewPayment, discardCase, listCases } from '@/lib/api/cases'
import { getPricing, getUploadRules } from '@/lib/api/config'
import { listCaseDocuments } from '@/lib/api/documents'
import { getErrorMessage } from '@/lib/errors'
import { acceptedLabel, titleFromFilename } from '@/lib/uploads'
import { formatCurrency } from '@/lib/utils'
import type { CaseOut, DocumentOut, Pricing, UploadRules } from '@/types/api'
import { usePageTitle } from '@/hooks/use-page-title'
import { BackLink } from '@/components/layout/back-link'

const schema = z.object({
  title: z.string().trim().min(3, 'At least 3 characters').max(255, 'At most 255 characters'),
  case_type: z.string().min(1, 'Choose a case type'),
  note: z.string().max(2000, 'At most 2,000 characters').optional(),
})
type FormValues = z.infer<typeof schema>

// What this page loads before it shows anything. Nothing here refetches while
// the person is working (a refetch could hand the form a different draft
// mid-upload); it is read fresh each time the page opens.
const loadOnce = {
  staleTime: Infinity,
  refetchOnMount: 'always',
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const

export interface CasePrefill {
  title?: string
  case_type?: string
}

export function NewCasePage() {
  usePageTitle('New case')
  const [params] = useSearchParams()
  const location = useLocation()
  const wantedDraft = params.get('draft')
  // Carried over from "Start a new case" on a rejected case; ignored once
  // there's an unfinished draft to resume instead.
  const prefill = (location.state as { prefill?: CasePrefill } | null)?.prefill

  const pricing = useQuery({ queryKey: ['pricing'], queryFn: getPricing, ...loadOnce })
  const rules = useQuery({ queryKey: ['upload-rules'], queryFn: getUploadRules, ...loadOnce })
  const cases = useQuery({ queryKey: ['cases'], queryFn: listCases, ...loadOnce })

  // An unfinished draft is continued, never duplicated.
  const draft: CaseOut | null =
    cases.data?.find((c) => c.status === 'draft' && (!wantedDraft || c.id === wantedDraft)) ?? null
  const documents = useQuery({
    queryKey: ['case-documents', draft?.id],
    queryFn: () => listCaseDocuments(draft!.id),
    enabled: !!draft,
    ...loadOnce,
  })

  const failed = [pricing, rules, cases, documents].find((q) => q.isError)
  if (failed) {
    return (
      <div className="mx-auto max-w-xl">
        <ErrorState
          error={failed.error}
          title="Couldn't load the new case form"
          onRetry={() => {
            void pricing.refetch()
            void rules.refetch()
            void cases.refetch()
            if (draft) void documents.refetch()
          }}
        />
      </div>
    )
  }
  if (!pricing.data || !rules.data || !cases.data || (draft && !documents.data)) {
    return (
      <div className="mx-auto max-w-xl space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <NewCaseForm
      pricing={pricing.data}
      rules={rules.data}
      draft={draft}
      draftDocuments={documents.data ?? []}
      prefill={draft ? undefined : prefill}
    />
  )
}

function NewCaseForm({
  pricing,
  rules,
  draft,
  draftDocuments,
  prefill,
}: {
  pricing: Pricing
  rules: UploadRules
  draft: CaseOut | null
  draftDocuments: DocumentOut[]
  prefill: CasePrefill | undefined
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { user } = useAuth()
  const openCheckout = useRazorpayCheckout()

  const [rejections, setRejections] = useState<string[]>([])
  const [attempted, setAttempted] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  const fee = formatCurrency(pricing.review_fee_inr)

  // The case is submitted by now, so this always ends by leaving the form:
  // into checkout, or, if that can't start, to the case page where the same
  // payment is one tap away.
  const onSubmitted = useCallback(
    async (caseId: string) => {
      void queryClient.invalidateQueries({ queryKey: ['cases'] })
      try {
        const order = await createReviewPayment(caseId)
        await openCheckout({
          order,
          name: 'Advocate Filing',
          description: 'Review fee',
          userEmail: user?.email,
          userName: user?.full_name,
          onSuccess: () => navigate(`/cases/${caseId}`, { state: { confirmingPayment: true } }),
          onDismiss: () => navigate(`/cases/${caseId}`),
        })
      } catch (err) {
        toast({
          variant: 'error',
          title: 'Your case is submitted, but payment did not start',
          description: `${getErrorMessage(err)} You can pay from the case page.`,
        })
        navigate(`/cases/${caseId}`)
      }
    },
    [navigate, openCheckout, queryClient, toast, user],
  )

  const submission = useCaseSubmission({
    rules,
    initial: draft ? { caseId: draft.id, documents: draftDocuments } : null,
    onSubmitted,
  })
  const { rows, phase, stepError } = submission

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: draft?.title ?? prefill?.title ?? '',
      case_type: draft?.case_type ?? prefill?.case_type ?? '',
      note: draft?.note ?? '',
    },
  })

  const onFiles = (files: File[]) => {
    const { added, rejected } = submission.addFiles(files)
    setRejections(rejected.map((r) => `"${r.name}" ${r.reason}`))
    // The title starts as the first file's name; the person's own wins.
    const first = added[0]
    if (first && !getValues('title').trim()) {
      setValue('title', titleFromFilename(first.name), { shouldValidate: attempted })
    }
  }

  const onRemove = async (id: string) => {
    try {
      await submission.removeRow(id)
    } catch (err) {
      toast({
        variant: 'error',
        title: "Couldn't remove the file",
        description: getErrorMessage(err),
      })
    }
  }

  const onValid = (values: FormValues) => {
    if (rows.length === 0) return
    void submission.submit({
      title: values.title,
      case_type: values.case_type,
      note: values.note?.trim() || undefined,
    })
  }

  const discard = async () => {
    if (!draft) return
    setDiscarding(true)
    try {
      await discardCase(draft.id)
      void queryClient.invalidateQueries({ queryKey: ['cases'] })
      toast({ variant: 'success', title: 'Draft discarded' })
      navigate('/')
    } catch (err) {
      setDiscarding(false)
      setConfirmDiscard(false)
      toast({
        variant: 'error',
        title: "Couldn't discard the draft",
        description: getErrorMessage(err),
      })
    }
  }

  const busy = phase !== 'idle'
  const uploaded = rows.filter((r) => r.status === 'uploaded').length
  const failedCount = rows.filter((r) => r.status === 'failed').length
  const label = {
    idle: failedCount > 0 ? `Retry and pay ${fee}` : `Submit and pay ${fee}`,
    saving: 'Saving…',
    uploading: `Uploading ${uploaded} of ${rows.length}`,
    submitting: 'Submitting…',
    paying: 'Opening payment…',
  }[phase]

  const knownType = !draft || (CASE_TYPES as readonly string[]).includes(draft.case_type)

  return (
    <div className="mx-auto max-w-xl">
      <BackLink to="/">All cases</BackLink>
      <h1 className="lg:text-title mb-1 text-2xl font-semibold">New case</h1>
      <p className="text-muted mb-6 text-sm">
        Add your files, then send the case to the advocate for review. The review fee is {fee}.
      </p>

      {draft && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-[var(--color-accent)]/5 px-4 py-3">
          <p className="text-accent-ink text-label">Continuing your unfinished draft.</p>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmDiscard(true)}>
            Start over
          </Button>
        </div>
      )}

      <Card>
        <form
          noValidate
          onSubmit={(e) => {
            setAttempted(true)
            void handleSubmit(onValid)(e)
          }}
          className="space-y-5"
        >
          <section aria-labelledby="files-heading" className="space-y-3">
            <h2 id="files-heading" className="text-sm font-medium">
              Files
            </h2>
            <Dropzone
              onFiles={onFiles}
              disabled={busy}
              accept={Object.keys(rules.accepted).join(',')}
              hint={`${acceptedLabel(rules)} · up to ${rules.max_files} files, ${rules.max_file_size_mb} MB each`}
            />
            {rejections.length > 0 && (
              <ul role="alert" className="text-danger-ink text-label space-y-1">
                {rejections.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
            {rows.length > 0 && (
              <ul className="space-y-2" aria-label="Files to submit">
                {rows.map((row) => (
                  <FileRow
                    key={row.id}
                    name={row.name}
                    size={row.size}
                    status={row.status}
                    progress={row.progress}
                    error={row.error}
                    busy={busy}
                    onRemove={() => void onRemove(row.id)}
                    onRetry={() => void submission.retryRow(row.id)}
                  />
                ))}
              </ul>
            )}
            <FieldError>
              {attempted && rows.length === 0 ? 'Add at least one file.' : undefined}
            </FieldError>
          </section>

          <Field id="title" label="Case title" error={errors.title?.message}>
            {(control) => (
              <Input
                {...control}
                placeholder="e.g. Property dispute: Sharma vs. Verma"
                disabled={busy}
                {...register('title')}
              />
            )}
          </Field>

          <Field id="case_type" label="Case type" error={errors.case_type?.message}>
            {(control) => (
              <Select {...control} disabled={busy} {...register('case_type')}>
                <option value="">Choose a type</option>
                {!knownType && draft && <option value={draft.case_type}>{draft.case_type}</option>}
                {CASE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="note" label="Note for the advocate (optional)" error={errors.note?.message}>
            {(control) => (
              <Textarea
                {...control}
                placeholder="Anything the advocate should know first"
                disabled={busy}
                {...register('note')}
              />
            )}
          </Field>

          <FieldError>{stepError ?? undefined}</FieldError>

          <div>
            <Button type="submit" className="w-full" size="lg" loading={busy}>
              {label}
            </Button>
            <p className="text-muted text-caption mt-2 text-center">
              You pay {fee} in the next step. It isn&apos;t refunded if the advocate defers the
              case.
            </p>
          </div>
        </form>
      </Card>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this draft?"
        description={`"${draft?.title ?? ''}" and its ${rows.length} uploaded ${rows.length === 1 ? 'file' : 'files'} will be deleted.`}
        confirmLabel="Discard draft"
        tone="danger"
        loading={discarding}
        onConfirm={() => void discard()}
      />
    </div>
  )
}
