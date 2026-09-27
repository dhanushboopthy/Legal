import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

const fieldClassName =
  'w-full min-h-12 rounded-[var(--radius-control)] border border-[var(--border-strong)] surface px-4 py-2.5 text-lead text-[var(--fg)] placeholder:text-[var(--fg-muted)] transition-shadow duration-150 focus:border-[var(--color-accent)] aria-[invalid=true]:border-[var(--color-danger)] disabled:opacity-60'

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

/** A password field with a visible Show/Hide button, so a mistyped password
 * can be checked instead of guessed at. */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>
>(({ className, ...props }, ref) => {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? 'text' : 'password'}
        className={cn(fieldClassName, 'pr-24', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 min-h-11 min-w-20 rounded-r-[var(--radius-control)] px-3 text-sm font-semibold text-[var(--color-accent-ink)] hover:bg-black/[0.05]"
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
})
PasswordInput.displayName = 'PasswordInput'

// A native select: on a phone it opens the OS picker, which beats any custom list.
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(fieldClassName, 'appearance-auto', className)} {...props}>
      {children}
    </select>
  ),
)
Select.displayName = 'Select'

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-2 block text-sm font-semibold text-[var(--fg)]', className)}
      {...props}
    />
  )
}

export function FieldError({ id, children }: { id?: string; children?: string }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="text-danger-ink mt-2 text-sm font-medium">
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
        <p id={hintId} className="text-muted mt-2 text-sm">
          {hint}
        </p>
      )}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  )
}
