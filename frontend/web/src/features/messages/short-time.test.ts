import { describe, expect, it } from 'vitest'

import { shortTime } from '@/features/messages/short-time'

const now = new Date('2026-09-27T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

describe('shortTime', () => {
  it('says "now" under a minute, and for a clock slightly ahead', () => {
    expect(shortTime(ago(30_000), now)).toBe('now')
    expect(shortTime(ago(-5_000), now)).toBe('now')
  })

  it('counts minutes, hours and days', () => {
    expect(shortTime(ago(5 * 60_000), now)).toBe('5m')
    expect(shortTime(ago(3 * 3_600_000), now)).toBe('3h')
    expect(shortTime(ago(2 * 86_400_000), now)).toBe('2d')
  })

  it('falls back to a date after a week, with the year only when it differs', () => {
    expect(shortTime('2026-09-12T12:00:00Z', now)).toMatch(/^12 Sept?$/)
    expect(shortTime('2025-09-12T12:00:00Z', now)).toMatch(/^12 Sept? 2025$/)
  })
})
