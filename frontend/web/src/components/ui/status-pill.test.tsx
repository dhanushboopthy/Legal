import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CaseStatusPill, PaymentStatusPill } from '@/components/ui/status-pill'

describe('CaseStatusPill', () => {
  it("describes the situation from the lawyer's side", () => {
    render(<CaseStatusPill status="review_fee_paid" perspective="submitter" />)
    expect(screen.getByText('In review')).toBeInTheDocument()
  })

  it("describes the same status from the advocate's side", () => {
    render(<CaseStatusPill status="review_fee_paid" perspective="reviewer" />)
    expect(screen.getByText('Needs your decision')).toBeInTheDocument()
  })

  it('renders the rejected status distinctly per side', () => {
    render(<CaseStatusPill status="rejected" perspective="reviewer" />)
    expect(screen.getByText('Declined')).toBeInTheDocument()
  })
})

describe('PaymentStatusPill', () => {
  it('renders a human-readable label for each status', () => {
    render(<PaymentStatusPill status="refunded" />)
    expect(screen.getByText('Refunded')).toBeInTheDocument()
  })
})
