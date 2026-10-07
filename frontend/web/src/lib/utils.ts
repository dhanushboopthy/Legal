import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Our named type steps (index.css @theme). Without this, tailwind-merge takes
// `text-label` for a colour and drops it next to a real colour class.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['caption', 'label', 'lead', 'title'] }] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amountInr: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amountInr)
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** "Just now", "5 min ago", "2 hours ago", then the time yesterday, then the date. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const diff = now.getTime() - then.getTime()
  if (diff < MINUTE) return 'Just now'
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE)
    return `${m} min ago`
  }
  const days = (startOfDay(now) - startOfDay(then)) / (24 * HOUR)
  if (days < 1) {
    const h = Math.floor(diff / HOUR)
    return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
  }
  if (days < 2) {
    return `Yesterday, ${new Intl.DateTimeFormat('en-IN', { timeStyle: 'short' }).format(then)}`
  }
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(then)
}

export type DayGroup = 'Today' | 'Yesterday' | 'Earlier'

export function dayGroup(iso: string, now: Date = new Date()): DayGroup {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / (24 * HOUR))
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return 'Earlier'
}
