import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LinkifiedText } from '@/features/chat/linkify'
import { splitLinks } from '@/features/chat/split-links'

afterEach(cleanup)

describe('splitLinks', () => {
  it('finds web addresses and leaves the rest as text', () => {
    expect(splitLinks('See https://example.com/a?b=1 for details')).toEqual([
      { text: 'See ' },
      { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { text: ' for details' },
    ])
  })

  it('leaves sentence punctuation out of the link', () => {
    const parts = splitLinks('Read http://example.com/x.')
    expect(parts[1]).toEqual({ text: 'http://example.com/x', href: 'http://example.com/x' })
    expect(parts[2]).toEqual({ text: '.' })
  })

  it('only links http and https', () => {
    expect(splitLinks('javascript:alert(1) and ftp://x.y and data:text/html,<b>')).toEqual([
      { text: 'javascript:alert(1) and ftp://x.y and data:text/html,<b>' },
    ])
  })
})

describe('LinkifiedText', () => {
  it('renders links that open safely in a new tab', () => {
    render(<p>{LinkifiedText({ text: 'Docs at https://example.com/docs now' })}</p>)
    const link = screen.getByRole('link', { name: 'https://example.com/docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders markup as text, never as HTML', () => {
    const { container } = render(
      <p>{LinkifiedText({ text: '<img src=x onerror=alert(1)> <b>bold</b>' })}</p>,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toBe('<img src=x onerror=alert(1)> <b>bold</b>')
  })
})
