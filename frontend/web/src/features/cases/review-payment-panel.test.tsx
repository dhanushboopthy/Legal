import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PaymentActionCard } from '@/features/cases/review-payment-panel'
import { apiClient } from '@/lib/api-client'
import { renderWithProviders } from '@/test/render-helpers'
import type { PaymentOrderResponse } from '@/types/api'

const { openCheckout } = vi.hoisted(() => ({ openCheckout: vi.fn() }))
vi.mock('@/hooks/use-razorpay', () => ({ useRazorpayCheckout: () => openCheckout }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const order: PaymentOrderResponse = {
  payment_id: 'pay1',
  razorpay_order_id: 'order_1',
  razorpay_key_id: 'rzp_test',
  amount_paise: 15000,
  currency: 'INR',
}

let api: MockAdapter

beforeEach(() => {
  api = new MockAdapter(apiClient)
  openCheckout.mockReset()
})

describe('PaymentActionCard', () => {
  it('shows the amount on the button and waits for it before enabling', () => {
    renderWithProviders(
      <PaymentActionCard
        createOrder={() => Promise.resolve(order)}
        title="Pay the review fee"
        description="Pay to proceed."
        amountInr={undefined}
        onPaid={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Pay' })).toBeDisabled()
  })

  it('pays, then shows the slow state with Check status after 60s, and calls onPaid once paid', async () => {
    vi.useFakeTimers()
    const onPaid = vi.fn()
    let succeed: () => void = () => {}
    openCheckout.mockImplementation(
      (opts: { onSuccess: () => void }) =>
        new Promise<void>((resolve) => {
          succeed = () => {
            opts.onSuccess()
            resolve()
          }
        }),
    )
    api.onPost('/payments/pay1/reconcile').reply(200, {
      id: 'pay1',
      case_id: 'c1',
      type: 'review',
      amount: 150,
      currency: 'INR',
      status: 'paid',
      quote_id: null,
      paid_at: '2026-09-15T10:00:00Z',
    })

    renderWithProviders(
      <PaymentActionCard
        createOrder={() => Promise.resolve(order)}
        title="Pay the review fee"
        description="Pay to proceed."
        amountInr={150}
        onPaid={onPaid}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Pay ₹150/ }))
    await vi.waitFor(() => expect(openCheckout).toHaveBeenCalled())
    await act(async () => succeed())
    expect(screen.getByText(/Confirming your payment/)).toBeInTheDocument()
    expect(onPaid).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(screen.getByText(/Taking longer than usual/)).toBeInTheDocument()
    vi.useRealTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    await vi.waitFor(() => expect(onPaid).toHaveBeenCalledTimes(2))
  })

  it('offers Retry when Razorpay reports the attempt failed', async () => {
    const user = userEvent.setup()
    openCheckout.mockImplementation((opts: { onFailed?: () => void }) => {
      opts.onFailed?.()
      return Promise.resolve()
    })

    renderWithProviders(
      <PaymentActionCard
        createOrder={() => Promise.resolve(order)}
        title="Pay the review fee"
        description="Pay to proceed."
        amountInr={150}
        onPaid={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Pay ₹150/ }))
    expect(await screen.findByRole('button', { name: 'Retry payment' })).toBeInTheDocument()
    expect(screen.getByText(/didn't go through/)).toBeInTheDocument()
  })
})
