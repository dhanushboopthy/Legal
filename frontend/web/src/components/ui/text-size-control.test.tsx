import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it } from 'vitest'

import { TextSizeControl } from '@/components/ui/text-size-control'
import { getTextSize } from '@/lib/preferences'

afterEach(() => {
  cleanup()
  localStorage.clear()
  delete document.documentElement.dataset.textSize
})

describe('TextSizeControl', () => {
  it('starts at Standard', () => {
    render(<TextSizeControl />)
    expect(screen.getByRole('radio', { name: /Standard/ })).toBeChecked()
  })

  it('enlarges the whole page and remembers the choice', async () => {
    render(<TextSizeControl />)
    await userEvent.click(screen.getByRole('radio', { name: /Largest/ }))

    expect(document.documentElement.dataset.textSize).toBe('xlarge')
    expect(getTextSize()).toBe('xlarge')
    expect(screen.getByRole('radio', { name: /Largest/ })).toBeChecked()
  })

  it('going back to Standard removes the scaling', async () => {
    render(<TextSizeControl />)
    await userEvent.click(screen.getByRole('radio', { name: 'Larger' }))
    await userEvent.click(screen.getByRole('radio', { name: /Standard/ }))
    expect(document.documentElement.dataset.textSize).toBeUndefined()
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<TextSizeControl />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
