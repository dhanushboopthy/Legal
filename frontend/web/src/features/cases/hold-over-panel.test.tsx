import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HeldOverPanel, HoldOverControl } from '@/features/cases/hold-over-panel'
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

describe('HoldOverControl', () => {
  it('holds the case over with the chosen reason and note', async () => {
    api.onPost('/cases/c1/hold').reply(200, { id: 'c1', status: 'held_over' })
    const onChanged = vi.fn()
    renderWithProviders(<HoldOverControl caseId="c1" onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Hold over' }))
    const confirm = screen.getByRole('button', { name: 'Hold over case' })
    expect(confirm).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Awaiting the court date' }))
    await userEvent.type(
      screen.getByLabelText('Note for the lawyer (optional)'),
      'Next hearing 14 Oct',
    )
    await userEvent.click(confirm)

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(api.history.post[0]?.data).toBe(
      JSON.stringify({ reason: 'Awaiting the court date. Next hearing 14 Oct' }),
    )
  })

  it('needs a written reason for "Another reason"', async () => {
    renderWithProviders(<HoldOverControl caseId="c1" onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Hold over' }))
    await userEvent.click(screen.getByRole('button', { name: 'Another reason' }))
    expect(screen.getByRole('button', { name: 'Hold over case' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Your reason'), 'Client travelling')
    expect(screen.getByRole('button', { name: 'Hold over case' })).toBeEnabled()
  })

  it('has no automatically detectable accessibility violations when open', async () => {
    const { container } = renderWithProviders(<HoldOverControl caseId="c1" onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Hold over' }))
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('HeldOverPanel', () => {
  it('lets the advocate resume work', async () => {
    api.onPost('/cases/c1/resume').reply(200, { id: 'c1', status: 'accepted' })
    const onChanged = vi.fn()
    renderWithProviders(
      <HeldOverPanel caseId="c1" reason="Matter adjourned." canResume onChanged={onChanged} />,
    )
    expect(screen.getByText('You held this case over: Matter adjourned.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Resume work' }))
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
  })

  it('tells the lawyer why, with nothing to press', () => {
    renderWithProviders(
      <HeldOverPanel caseId="c1" reason="Matter adjourned" canResume={false} onChanged={vi.fn()} />,
    )
    expect(
      screen.getByText(/The advocate has held this case over: Matter adjourned\./),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
