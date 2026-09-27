import { describe, expect, it } from 'vitest'

import { shortTime } from '@/features/messages/short-time'

// Local times, so "today" and "yesterday" don't depend on the runner's zone.
const now = new Date(2026, 8, 27, 18, 0)
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

describe('shortTime', () => {
  it('says "Just now" under a minute, and for a clock slightly ahead', () => {
    expect(shortTime(ago(30_000), now)).toBe('Just now')
    expect(shortTime(ago(-5_000), now)).toBe('Just now')
  })

  it('counts minutes in words', () => {
    expect(shortTime(ago(5 * 60_000), now)).toBe('5 min ago')
  })

  it('gives the time for earlier today', () => {
    expect(shortTime(new Date(2026, 8, 27, 15, 5).toISOString(), now)).toMatch(/^Today, 3:05\s?pm$/i)
  })

  it('says "Yesterday"', () => {
    expect(shortTime(new Date(2026, 8, 26, 9, 0).toISOString(), now)).toBe('Yesterday')
  })

  it('falls back to a date, with the year only when it differs', () => {
    expect(shortTime(new Date(2026, 8, 12, 12).toISOString(), now)).toMatch(/^12 Sept?$/)
    expect(shortTime(new Date(2025, 8, 12, 12).toISOString(), now)).toMatch(/^12 Sept? 2025$/)
  })
})
