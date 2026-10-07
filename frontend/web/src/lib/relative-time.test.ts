import { describe, expect, it } from 'vitest'

import { dayGroup, formatRelativeTime } from '@/lib/utils'

const now = new Date(2026, 9, 3, 15, 0, 0) // 3 Oct 2026, 3:00 pm local
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN

describe('formatRelativeTime', () => {
  it('uses plain words, not abbreviations like "5m"', () => {
    expect(formatRelativeTime(ago(20_000), now)).toBe('Just now')
    expect(formatRelativeTime(ago(5 * MIN), now)).toBe('5 min ago')
    expect(formatRelativeTime(ago(HOUR), now)).toBe('1 hour ago')
    expect(formatRelativeTime(ago(2 * HOUR), now)).toBe('2 hours ago')
  })

  it('says "Yesterday" with the time, then a date', () => {
    const yesterday = new Date(2026, 9, 2, 19, 30).toISOString()
    expect(formatRelativeTime(yesterday, now)).toMatch(/^Yesterday, 7:30\s?pm$/i)
    expect(formatRelativeTime(new Date(2026, 8, 20, 10, 0).toISOString(), now)).toBe('20 Sept')
  })
})

describe('dayGroup', () => {
  it('groups by calendar day, not by 24-hour windows', () => {
    expect(dayGroup(new Date(2026, 9, 3, 0, 5).toISOString(), now)).toBe('Today')
    expect(dayGroup(new Date(2026, 9, 2, 23, 55).toISOString(), now)).toBe('Yesterday')
    expect(dayGroup(new Date(2026, 9, 1, 12, 0).toISOString(), now)).toBe('Earlier')
  })
})
