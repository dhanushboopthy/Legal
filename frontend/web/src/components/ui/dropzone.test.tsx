import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dropzone, FileRow } from '@/components/ui/dropzone'

afterEach(cleanup)

const pdf = (name = 'a.pdf') => new File(['%PDF-'], name, { type: 'application/pdf' })

describe('Dropzone', () => {
  it('reports every file chosen at once', async () => {
    const onFiles = vi.fn()
    render(<Dropzone onFiles={onFiles} accept=".pdf" hint="PDF only" />)

    await userEvent.upload(screen.getByTestId('file-input'), [pdf('a.pdf'), pdf('b.pdf')])

    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0]?.[0].map((f: File) => f.name)).toEqual(['a.pdf', 'b.pdf'])
  })

  it('reports files dropped on it', () => {
    const onFiles = vi.fn()
    render(<Dropzone onFiles={onFiles} accept=".pdf" hint="PDF only" />)

    fireEvent.drop(screen.getByRole('button', { name: /choose files/i }), {
      dataTransfer: { files: [pdf('dropped.pdf')] },
    })

    expect(onFiles.mock.calls[0]?.[0][0].name).toBe('dropped.pdf')
  })

  it('ignores a drop while disabled', () => {
    const onFiles = vi.fn()
    render(<Dropzone onFiles={onFiles} accept=".pdf" hint="PDF only" disabled />)

    fireEvent.drop(screen.getByRole('button', { name: /choose files/i }), {
      dataTransfer: { files: [pdf()] },
    })

    expect(onFiles).not.toHaveBeenCalled()
  })

  it('tells the person what it accepts', () => {
    render(<Dropzone onFiles={vi.fn()} accept=".pdf" hint="PDF, DOC or PNG · up to 10 files" />)
    expect(screen.getByText('PDF, DOC or PNG · up to 10 files')).toBeInTheDocument()
  })
})

describe('FileRow', () => {
  it('shows a failed file with its reason, and lets the person retry or remove it', async () => {
    const onRetry = vi.fn()
    const onRemove = vi.fn()
    render(
      <ul>
        <FileRow
          name="scan.png"
          size={2048}
          status="failed"
          error="The upload was interrupted."
          onRetry={onRetry}
          onRemove={onRemove}
        />
      </ul>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('The upload was interrupted.')
    await userEvent.click(screen.getByRole('button', { name: 'Retry scan.png' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove scan.png' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('exposes upload progress to assistive tech and cannot be removed mid-upload', () => {
    render(
      <ul>
        <FileRow
          name="big.pdf"
          size={5_000_000}
          status="uploading"
          progress={0.42}
          onRemove={vi.fn()}
        />
      </ul>,
    )

    const bar = screen.getByRole('progressbar', { name: 'Uploading big.pdf' })
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByRole('button', { name: 'Remove big.pdf' })).toBeDisabled()
  })

  it('marks a finished upload', () => {
    render(
      <ul>
        <FileRow name="a.pdf" size={1024} status="uploaded" />
      </ul>,
    )
    expect(screen.getByText('Uploaded')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('does not offer retry on a file that has not failed', () => {
    render(
      <ul>
        <FileRow name="a.pdf" size={1024} status="queued" onRetry={vi.fn()} />
      </ul>,
    )
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })
})
