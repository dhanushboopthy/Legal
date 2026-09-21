import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from '@/components/error-boundary'

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('boom')
  return <p>all good</p>
}

const renderBoundary = (resetKey: string, explode: boolean) => (
  <MemoryRouter>
    <ErrorBoundary resetKey={resetKey}>
      <Boom explode={explode} />
    </ErrorBoundary>
  </MemoryRouter>
)

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows the recovery page instead of a blank screen when a child crashes', () => {
    render(renderBoundary('/a', true))
    expect(screen.getByText('Something went wrong')).toBeTruthy()
  })

  it('clears the error once the route changes', () => {
    const { rerender } = render(renderBoundary('/a', true))
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    rerender(renderBoundary('/b', false))
    expect(screen.getByText('all good')).toBeTruthy()
  })
})
