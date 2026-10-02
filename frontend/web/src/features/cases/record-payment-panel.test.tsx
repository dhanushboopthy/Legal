import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RecordPaymentPanel } from '@/features/cases/record-payment-panel'
import { apiClient } from '@/lib/api-client'
import { renderWithProviders } from '@/test/render-helpers'

const quote = {
  id: 'q1',
  case_id: 'c1',
  version: 1,
  amount_inr: 2500,
  amount_paise: 250000,
  currency: 'INR',
  note: null,
  status: 'open',
  draft_document_id: 'd1',
  created_at: '2026-09-30T10:00:00Z',
  paid_at: null,
}

let api: MockAdapter
beforeEach(() => {
  api = new MockAdapter(apiClient)
  api.onGet('/cases/c1/quote').reply(200, quote)
})
afterEach(() => {
  cleanup()
  api.restore()
})

function renderPanel(props: Partial<Parameters<typeof RecordPaymentPanel>[0]> = {}) {
  const onChanged = vi.fn()
  const onReplace = vi.fn()
  const result = renderWithProviders(
    <RecordPaymentPanel
      caseId="c1"
      canRecord
      canReplace
      onReplace={onReplace}
      onChanged={onChanged}
      {...props}
    />,
  )
  return { ...result, onChanged, onReplace }
}

describe('RecordPaymentPanel', () => {
  it('shows the amount owed before anything else', async () => {
    renderPanel()
    expect(await screen.findByText('Waiting for the lawyer to pay ₹2,500')).toBeInTheDocument()
  })

  it('records a GPay payment with its reference and never sends an amount', async () => {
    api.onPost('/cases/c1/quote/record-payment').reply(201, { id: 'p1', status: 'paid' })
    const { onChanged, toast } = renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: 'Record a payment received' }))
    const confirm = screen.getByRole('button', { name: 'Mark ₹2,500 as received' })
    expect(confirm).toBeDisabled() // until a method is chosen

    await userEvent.click(screen.getByRole('button', { name: 'GPay / UPI' }))
    await userEvent.type(screen.getByLabelText('Reference (optional)'), ' 4021 7788 ')
    await userEvent.click(confirm)

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(JSON.parse(api.history.post[0]?.data as string)).toEqual({
      method: 'upi',
      reference: '4021 7788',
    })
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Payment recorded' }))
  })

  it('shows the server’s reason when recording fails, and stays open', async () => {
    api
      .onPost('/cases/c1/quote/record-payment')
      .reply(409, { detail: 'There are no unpaid drafting charges on this case' })
    const { onChanged, toast } = renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: 'Record a payment received' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cash' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark ₹2,500 as received' }))

    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          description: 'There are no unpaid drafting charges on this case',
        }),
      ),
    )
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Mark ₹2,500 as received' })).toBeInTheDocument()
  })

  it('offers only what the advocate may do', async () => {
    renderPanel({ canRecord: false })
    expect(
      await screen.findByRole('button', { name: 'Replace draft or change charges' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record a payment received' })).toBeNull()
  })

  it('says so when the charges can’t be loaded, rather than showing nothing', async () => {
    api.reset()
    api.onGet('/cases/c1/quote').reply(500, { detail: 'boom' })
    renderPanel()
    expect(await screen.findByText("Couldn't load the drafting charges")).toBeInTheDocument()
  })

  it('has no automatically detectable accessibility violations when open', async () => {
    const { container } = renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Record a payment received' }))
    expect(await axe(container)).toHaveNoViolations()
  })
})
