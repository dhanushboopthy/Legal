import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DecisionPanel } from '@/features/cases/decision-panel'
import { apiClient } from '@/lib/api-client'
import { renderWithProviders } from '@/test/render-helpers'

let api: MockAdapter
beforeEach(() => {
  api = new MockAdapter(apiClient)
})
afterEach(() => {
  cleanup()
  api.restore()
})

describe('DecisionPanel', () => {
  it('accepts the case and reports what happens next', async () => {
    api.onPatch('/cases/c1/decision').reply(200, { id: 'c1', status: 'accepted' })
    const onDecided = vi.fn()
    const { toast } = renderWithProviders(
      <DecisionPanel caseId="c1" onDecided={onDecided} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Accept case' }))

    await vi.waitFor(() => expect(onDecided).toHaveBeenCalledOnce())
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success', title: 'Case accepted' }),
    )
    expect(api.history.patch[0]?.data).toBe(
      JSON.stringify({ accept: true, rejection_reason: '' }),
    )
  })

  it('requires a reason before a rejection can be confirmed', async () => {
    renderWithProviders(<DecisionPanel caseId="c1" onDecided={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Reject case' }))
    const confirm = screen.getByRole('button', { name: 'Confirm rejection' })
    expect(confirm).toBeDisabled()

    await userEvent.type(
      screen.getByLabelText('Reason for rejection'),
      "Doesn't have a case",
    )
    expect(confirm).toBeEnabled()
  })

  it('rejects with the typed reason', async () => {
    api.onPatch('/cases/c1/decision').reply(200, { id: 'c1', status: 'rejected' })
    const onDecided = vi.fn()
    renderWithProviders(<DecisionPanel caseId="c1" onDecided={onDecided} />)

    await userEvent.click(screen.getByRole('button', { name: 'Reject case' }))
    await userEvent.type(screen.getByLabelText('Reason for rejection'), 'Out of scope')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }))

    await vi.waitFor(() => expect(onDecided).toHaveBeenCalledOnce())
    expect(JSON.parse(api.history.patch[0]?.data as string)).toEqual({
      accept: false,
      rejection_reason: 'Out of scope',
    })
  })

  it('surfaces the server error and leaves the case undecided', async () => {
    api.onPatch('/cases/c1/decision').reply(500, { detail: 'Case already decided' })
    const { toast } = renderWithProviders(<DecisionPanel caseId="c1" onDecided={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Accept case' }))

    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          title: 'Could not save decision',
          description: 'Case already decided',
        }),
      ),
    )
  })

  it('has no automatically detectable accessibility violations', async () => {
    const { container } = renderWithProviders(<DecisionPanel caseId="c1" onDecided={vi.fn()} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
