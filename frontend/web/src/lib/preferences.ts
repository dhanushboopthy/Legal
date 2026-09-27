export type TextSize = 'normal' | 'large' | 'xlarge'

export const TEXT_SIZES: { value: TextSize; label: string; sample: string }[] = [
  { value: 'normal', label: 'Normal', sample: 'A' },
  { value: 'large', label: 'Large', sample: 'A+' },
  { value: 'xlarge', label: 'Extra large', sample: 'A++' },
]

const KEY = 'text-size'

function isTextSize(value: unknown): value is TextSize {
  return value === 'normal' || value === 'large' || value === 'xlarge'
}

// Storage can be unavailable (private windows, blocked site data); the
// setting then simply lasts until the page is closed.
export function getTextSize(): TextSize {
  try {
    const stored = localStorage.getItem(KEY)
    return isTextSize(stored) ? stored : 'normal'
  } catch {
    return 'normal'
  }
}

export function applyTextSize(size: TextSize): void {
  if (size === 'normal') delete document.documentElement.dataset.textSize
  else document.documentElement.dataset.textSize = size
}

export function setTextSize(size: TextSize): void {
  applyTextSize(size)
  try {
    localStorage.setItem(KEY, size)
  } catch {
    // Not persisted; still applied for this visit.
  }
}
