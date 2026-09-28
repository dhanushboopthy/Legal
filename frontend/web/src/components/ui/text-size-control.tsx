import { useId, useState } from 'react'

import { getTextSize, setTextSize, TEXT_SIZES, type TextSize } from '@/lib/preferences'
import { cn } from '@/lib/utils'

/** Standard / Larger / Largest, as a segmented control. Changes the whole app
 * at once and is remembered on this device. Native radios, so arrow keys work.
 * `compact` is the small inline version for the sign-in screens. */
export function TextSizeControl({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [size, setSize] = useState<TextSize>(getTextSize)
  const name = useId()

  function choose(next: TextSize) {
    setTextSize(next)
    setSize(next)
  }

  return (
    <fieldset className={cn(compact && 'flex flex-wrap items-center justify-center gap-x-3 gap-y-2', className)}>
      <legend className={cn('text-sm font-medium', compact ? 'text-muted float-left' : 'mb-2')}>
        Text size
      </legend>
      <div className="inline-flex flex-wrap gap-1 rounded-full bg-black/[0.06] p-1">
        {TEXT_SIZES.map((option) => {
          const checked = option.value === size
          return (
            <label
              key={option.value}
              className={cn(
                'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-accent)]',
                checked ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'hover:bg-black/[0.04]',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => choose(option.value)}
                className="sr-only"
              />
              {!compact && (
                <span aria-hidden className="font-semibold">
                  {option.sample}
                </span>
              )}
              {option.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
