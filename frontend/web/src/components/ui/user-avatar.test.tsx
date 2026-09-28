import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { UserAvatar } from '@/components/ui/user-avatar'

afterEach(cleanup)

describe('UserAvatar', () => {
  it('shows initials when there is no photo', () => {
    const { container } = render(<UserAvatar name="Priya Shah" />)
    expect(container.textContent).toBe('PS')
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows the photo, and falls back to initials if it fails to load', () => {
    const { container } = render(
      <UserAvatar name="Priya Shah" src="https://store.test/avatars/u1/a.jpg?sig=1" />,
    )
    const img = container.querySelector('img')!
    expect(img).toHaveAttribute('src', 'https://store.test/avatars/u1/a.jpg?sig=1')
    fireEvent.error(img)
    expect(container.textContent).toBe('PS')
  })

  it('reuses the first signed URL for the same photo, so it is not downloaded again', () => {
    const first = 'https://store.test/avatars/u2/b.jpg?sig=first'
    const { container, rerender } = render(<UserAvatar name="A B" src={first} />)
    rerender(<UserAvatar name="A B" src="https://store.test/avatars/u2/b.jpg?sig=second" />)
    expect(container.querySelector('img')).toHaveAttribute('src', first)
  })
})
