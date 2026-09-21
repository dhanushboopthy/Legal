import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ErrorState } from '@/components/ui/error-state'

afterEach(cleanup)

describe('ErrorState', () => {
  it("announces the server's explanation, not an empty-list message", () => {
    const response = { status: 409, data: { detail: 'Case is locked' } } as AxiosResponse
    const error = new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, response)
    render(<ErrorState error={error} title="Couldn't load cases" />)

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load cases")
    expect(screen.getByText('Case is locked')).toBeInTheDocument()
    expect(screen.queryByText(/no cases yet/i)).toBeNull()
  })

  it('retries when asked, and offers no button when there is nothing to retry', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<ErrorState onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()

    rerender(<ErrorState />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
