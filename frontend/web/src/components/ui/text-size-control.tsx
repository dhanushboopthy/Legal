import { useId, useState } from 'react'

import { getTextSize, setTextSize, TEXT_SIZES, type TextSize } from '@/lib/preferences'
import { cn } from '@/lib/utils'

/** Normal / Large / Extra large. Changes the whole app at once and is
 * remembered on this device. Native radios, so arrow keys work as expected. */
export function TextSizeControl({ className }: { className?: string }) {
  const [size, setSize] = useState<TextSize>(getTextSize)
  const name = useId()

  function choose(next: TextSize) {
    setTextSize(next)
    setSize(next)
  }

  return (
    <fieldset className={className}>
      <legend className="mb-2 text-sm font-semibold">Text size</legend>
      <div className="flex flex-wrap gap-2">
        {TEXT_SIZES.map((option) => {
          const checked = option.value === size
          return (
            <label
              key={option.value}
              className={cn(
                'inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-4 text-sm font-semibold transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-accent)]',
                checked
                  ? 'border-[var(--fg)] bg-[var(--fg)] text-white'
                  : 'surface border-[var(--border-strong)] hover:bg-black/[0.04]',
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
              <span aria-hidden className="font-bold">
                {option.sample}
              </span>
              {option.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
