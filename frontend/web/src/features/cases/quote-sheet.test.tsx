import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QuoteSheet } from '@/features/cases/quote-sheet'
import { apiClient } from '@/lib/api-client'
import { renderWithProviders } from '@/test/render-helpers'
import type { Pricing } from '@/types/api'

afterEach(cleanup)

const pricing: Pricing = { review_fee_inr: 100, quote_min_inr: 100, quote_max_inr: 100000 }
const pdf = (name = 'draft.pdf') => new File(['%PDF-'], name, { type: 'application/pdf' })

let api: MockAdapter
let storage: MockAdapter

beforeEach(() => {
  api = new MockAdapter(apiClient)
  storage = new MockAdapter(axios)
  api.onPost('/documents/upload-url').reply(200, {
    upload_url: 'https://store.test/draft.pdf?put=1',
    storage_key: 'cases/c1/draft.pdf',
    expires_in_seconds: 300,
  })
  storage.onPut(/store\.test/).reply(200)
})

describe('QuoteSheet', () => {
  it('sends the draft and price, and reports the amount range', async () => {
    const user = userEvent.setup()
    const onSent = vi.fn()
    api.onPost('/cases/c1/quote').reply((config) => {
      const body = JSON.parse(config.data as string)
      expect(body).toEqual({
        draft: { storage_key: 'cases/c1/draft.pdf', original_filename: 'draft.pdf' },
        amount_inr: 2500,
        note: undefined,
      })
      return [
        201,
        {
          id: 'q1',
          case_id: 'c1',
          version: 1,
          amount_inr: 2500,
          amount_paise: 250000,
          currency: 'INR',
          note: null,
          status: 'open',
          draft_document_id: 'd1',
          created_at: '2026-09-15T10:00:00Z',
          paid_at: null,
        },
      ]
    })

    renderWithProviders(
      <QuoteSheet caseId="c1" pricing={pricing} open onOpenChange={vi.fn()} onSent={onSent} />,
    )

    expect(screen.getByText(/Between ₹100 and ₹1,00,000/)).toBeInTheDocument()

    await user.upload(screen.getByTestId('file-input'), pdf())
    await user.type(screen.getByPlaceholderText('2500'), '2500')
    await user.click(screen.getByRole('button', { name: 'Send draft and quote' }))

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
  })

  it('refuses an amount outside the server-set range', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <QuoteSheet caseId="c1" pricing={pricing} open onOpenChange={vi.fn()} onSent={vi.fn()} />,
    )

    await user.upload(screen.getByTestId('file-input'), pdf())
    await user.type(screen.getByPlaceholderText('2500'), '50')
    await user.click(screen.getByRole('button', { name: 'Send draft and quote' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/between ₹100 and ₹1,00,000/)
  })
})
