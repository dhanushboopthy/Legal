import { zodResolver } from '@hookform/resolvers/zod'
import { UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FieldError, Input, Label, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast-context'
import { createCase } from '@/lib/api/cases'
import { uploadCaseDocument } from '@/lib/api/documents'

const schema = z.object({
  title: z.string().min(3, 'At least 3 characters').max(255),
  case_type: z.string().min(2, 'At least 2 characters').max(100),
  court: z.string().max(150).optional(),
  description: z.string().max(5000).optional(),
})
type FormValues = z.infer<typeof schema>

export function NewCasePage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true)
    try {
      const created = await createCase(values)
      if (file) {
        await uploadCaseDocument(created.id, file, 'original')
      }
      toast({
        variant: 'success',
        title: 'Case submitted',
        description: 'Pay the review fee to send it for review.',
      })
      navigate(`/cases/${created.id}`)
    } catch {
      toast({ variant: 'error', title: 'Could not submit case', description: 'Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Submit a new case</h1>
      <p className="text-muted mb-6 text-sm">
        Give the advocate the details they need to review your case.
      </p>

      <Card>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="title">Case title</Label>
            <Input
              id="title"
              placeholder="e.g. Property dispute — Sharma vs. Verma"
              {...register('title')}
            />
            <FieldError>{errors.title?.message}</FieldError>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="case_type">Case type</Label>
              <Input id="case_type" placeholder="Civil, criminal, ..." {...register('case_type')} />
              <FieldError>{errors.case_type?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="court">Court (optional)</Label>
              <Input id="court" placeholder="e.g. District Court, Pune" {...register('court')} />
            </div>
          </div>
          <div>
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Brief background on the case"
              {...register('description')}
            />
          </div>

          <div>
            <Label>Original case document (optional)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-dashed border-[var(--border)] px-4 py-3 text-left text-sm transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
            >
              <UploadCloud className="size-4 text-[var(--fg-muted)]" />
              {file ? file.name : 'Upload PDF (you can also add this later)'}
            </button>
          </div>

          <Button type="submit" className="w-full" loading={submitting}>
            Submit case
          </Button>
        </form>
      </Card>
    </div>
  )
}
