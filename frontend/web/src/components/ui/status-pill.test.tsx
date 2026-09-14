import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CaseStatusPill, PaymentStatusPill } from '@/components/ui/status-pill'

describe('CaseStatusPill', () => {
  it('renders a human-readable label for each status', () => {
    render(<CaseStatusPill status="review_fee_paid" />)
    expect(screen.getByText('Review fee paid')).toBeInTheDocument()
  })

  it('renders the rejected status distinctly', () => {
    render(<CaseStatusPill status="rejected" />)
    expect(screen.getByText('Rejected')).toBeInTheDocument()
  })
})

describe('PaymentStatusPill', () => {
  it('renders a human-readable label for each status', () => {
    render(<PaymentStatusPill status="refunded" />)
    expect(screen.getByText('Refunded')).toBeInTheDocument()
  })
})
