import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'

import { cn } from '@/lib/utils'

const fieldClassName =
  'w-full rounded-[var(--radius-control)] border border-[var(--border)] surface px-3.5 py-2.5 text-lead text-[var(--fg)] placeholder:text-[var(--fg-muted)] transition-shadow duration-150 outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40 focus:border-[var(--color-accent)] disabled:opacity-50'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldClassName, className)} {...props} />
  ),
)
Input.displayName = 'Input'

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldClassName, 'min-h-24 resize-y', className)} {...props} />
))
Textarea.displayName = 'Textarea'

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-label mb-1.5 block font-medium text-[var(--fg-muted)]', className)}
      {...props}
    />
  )
}

export function FieldError({ id, children }: { id?: string; children?: string }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="text-label text-danger-ink mt-1.5">
      {children}
    </p>
  )
}

export interface FieldControlProps {
  id: string
  'aria-invalid'?: true
  'aria-describedby'?: string
}

/**
 * Label + control + hint + error, with the accessibility wiring done once:
 * the control gets `aria-invalid` and `aria-describedby` pointing at the
 * hint/error text, and the error is announced (`role="alert"`). The control is
 * a render prop so it works with Input, Textarea or a select.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: (control: FieldControlProps) => ReactNode
}) {
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ')

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
      })}
      {hint && (
        <p id={hintId} className="text-muted text-label mt-1.5">
          {hint}
        </p>
      )}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  )
}
