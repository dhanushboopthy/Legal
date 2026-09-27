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

  it('needs a reason before a case can be declined', async () => {
    renderWithProviders(<DecisionPanel caseId="c1" onDecided={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Decline' }))
    const confirm = screen.getByRole('button', { name: 'Decline case' })
    expect(confirm).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Conflict of interest' }))
    expect(confirm).toBeEnabled()
  })

  it('"Another reason" needs the reason written out', async () => {
    renderWithProviders(<DecisionPanel caseId="c1" onDecided={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Another reason' }))
    const confirm = screen.getByRole('button', { name: 'Decline case' })
    expect(confirm).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Your reason'), "Doesn't have a case")
    expect(confirm).toBeEnabled()
  })

  it('declines with the chosen reason and the note', async () => {
    api.onPatch('/cases/c1/decision').reply(200, { id: 'c1', status: 'rejected' })
    const onDecided = vi.fn()
    renderWithProviders(<DecisionPanel caseId="c1" onDecided={onDecided} />)

    await userEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Outside my practice area' }))
    await userEvent.type(screen.getByLabelText(/Note for the lawyer/), 'Try a tax specialist')
    await userEvent.click(screen.getByRole('button', { name: 'Decline case' }))

    await vi.waitFor(() => expect(onDecided).toHaveBeenCalledOnce())
    expect(JSON.parse(api.history.patch[0]?.data as string)).toEqual({
      accept: false,
      rejection_reason: 'Outside my practice area. Try a tax specialist',
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
