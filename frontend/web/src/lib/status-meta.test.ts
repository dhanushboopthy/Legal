import { describe, expect, it } from 'vitest'

import { PERMISSIONS } from '@/auth/permissions'
import { STATUS_META, getStatusMeta, perspectiveFor } from '@/lib/status-meta'
import type { CaseStatus } from '@/types/api'

const statuses = Object.keys(STATUS_META) as CaseStatus[]
const perspectives = ['submitter', 'reviewer'] as const

describe('STATUS_META', () => {
  it('gives every status a label and a next-step sentence for both sides', () => {
    for (const status of statuses) {
      for (const perspective of perspectives) {
        const meta = getStatusMeta(status, perspective)
        expect(meta.label.length, `${status}/${perspective} label`).toBeGreaterThan(0)
        expect(meta.next.length, `${status}/${perspective} next`).toBeGreaterThan(0)
      }
    }
  })

  it('never hard-codes an amount: fees come from the server', () => {
    for (const status of statuses) {
      for (const perspective of perspectives) {
        const { label, next } = getStatusMeta(status, perspective)
        expect(`${label} ${next}`, `${status}/${perspective}`).not.toMatch(/₹|Rs\.?\s?\d|\d{2,}/)
      }
    }
  })

  it('has exactly one side whose turn it is while a case is waiting on someone', () => {
    // Where one side acts, the other must be waiting (or the case is closed).
    for (const status of statuses) {
      const a = STATUS_META[status].submitter.turn
      const b = STATUS_META[status].reviewer.turn
      expect(a === 'you' && b === 'you', `${status} has two people to act`).toBe(false)
    }
  })
})

describe('perspectiveFor', () => {
  it('treats whoever can file cases as the submitter and everyone else as a reviewer', () => {
    expect(perspectiveFor((p) => p === PERMISSIONS.CASE_SUBMIT)).toBe('submitter')
    expect(perspectiveFor((p) => p === PERMISSIONS.CASE_VIEW_ALL)).toBe('reviewer')
  })
})
