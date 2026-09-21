import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Sheet } from '@/components/ui/sheet'

afterEach(cleanup)

describe('ConfirmDialog', () => {
  const setup = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Refund ₹100 to Priya?"
        confirmLabel="Refund"
        onConfirm={onConfirm}
        {...props}
      />,
    )
    return { onConfirm, onOpenChange }
  }

  it('names the thing being confirmed and runs it only on the confirm button', async () => {
    const { onConfirm } = setup()
    expect(screen.getByRole('dialog', { name: 'Refund ₹100 to Priya?' })).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Refund' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('closes without confirming on cancel', async () => {
    const { onConfirm, onOpenChange } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('cannot be cancelled mid-request', () => {
    setup({ loading: true })
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})

describe('Sheet', () => {
  it('shows its content only while open, with a named close button', () => {
    const { rerender } = render(
      <Sheet open onOpenChange={() => {}} title="Files">
        <p>original.pdf</p>
      </Sheet>,
    )
    expect(screen.getByRole('dialog', { name: 'Files' })).toBeInTheDocument()
    expect(screen.getByText('original.pdf')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()

    rerender(
      <Sheet open={false} onOpenChange={() => {}} title="Files">
        <p>original.pdf</p>
      </Sheet>,
    )
    expect(screen.queryByText('original.pdf')).toBeNull()
  })

  it('asks to close when the close button is pressed', async () => {
    const onOpenChange = vi.fn()
    render(
      <Sheet open onOpenChange={onOpenChange} title="Files">
        <p>x</p>
      </Sheet>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
