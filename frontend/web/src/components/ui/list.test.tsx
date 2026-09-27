import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { List, ListRow } from '@/components/ui/list'

afterEach(cleanup)

describe('List', () => {
  it('makes a row with `to` one large link, and a row with onClick a button', async () => {
    const onClick = vi.fn()
    render(
      <MemoryRouter>
        <List heading="Cases">
          <ListRow to="/cases/c1" title="Bail petition" subtitle="LF-2026-0001" />
          <ListRow title="Case details" onClick={onClick} />
          <ListRow title="Plain row" />
        </List>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /Bail petition/ })).toHaveAttribute('href', '/cases/c1')
    await userEvent.click(screen.getByRole('button', { name: /Case details/ }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /Plain row/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Cases' })).toBeInTheDocument()
  })

  it('has no accessibility violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <List heading="Account">
          <ListRow title="Name" subtitle="Priya Shah" />
          <ListRow to="/help" title="Help" />
        </List>
      </MemoryRouter>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
