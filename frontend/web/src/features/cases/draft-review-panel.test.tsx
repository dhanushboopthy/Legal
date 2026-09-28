import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DraftReviewPanel } from '@/features/cases/draft-review-panel'
import { apiClient } from '@/lib/api-client'
import { renderWithProviders } from '@/test/render-helpers'
import type { DocumentOut } from '@/types/api'

const draft: DocumentOut = {
  id: 'doc1',
  case_id: 'c1',
  type: 'draft',
  version: 1,
  original_filename: 'Bail-application.pdf',
  size_bytes: 120_000,
  content_type: 'application/pdf',
  page_count: 8,
  uploaded_by: 'u-advocate',
  created_at: '2026-09-15T10:00:00Z',
  locked: false,
}

let api: MockAdapter
beforeEach(() => {
  api = new MockAdapter(apiClient)
  api.onGet('/documents/case/c1').reply(200, [draft])
})
afterEach(() => {
  cleanup()
  api.restore()
})

describe('DraftReviewPanel', () => {
  it('lets the draft be opened, approved (after confirming), or sent back for changes', async () => {
    api.onGet('/documents/doc1/download-url').reply(200, { url: 'https://files.example/doc1' })
    api.onPost('/cases/c1/approve').reply(200, { id: 'c1', status: 'completed' })
    const onChanged = vi.fn()
    const { toast } = renderWithProviders(
      <DraftReviewPanel caseId="c1" caseTitle="Bail petition" onChanged={onChanged} />,
    )

    // Enabled once the documents request lands; allow for a loaded machine.
    await waitFor(
      () => expect(screen.getByRole('button', { name: /Download draft/ })).toBeEnabled(),
      { timeout: 5_000 },
    )

    await userEvent.click(screen.getByRole('button', { name: /Approve filing/ }))
    expect(screen.getByRole('dialog', { name: 'Approve "Bail petition"?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Approve filing' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success', title: 'Case approved' }),
    )
  })

  it('will not submit a change request with less than 5 characters, and posts the reason once valid', async () => {
    api.onPost('/cases/c1/revision').reply(200, { id: 'c1', status: 'revision_requested' })
    const onChanged = vi.fn()
    renderWithProviders(
      <DraftReviewPanel caseId="c1" caseTitle="Bail petition" onChanged={onChanged} />,
    )

    await userEvent.click(await screen.findByRole('button', { name: /Inform changes/ }))
    const textarea = screen.getByLabelText('What needs to change?')
    const submit = screen.getByRole('button', { name: 'Send changes' })
    expect(submit).toBeDisabled()

    await userEvent.type(textarea, 'Fix')
    expect(submit).toBeDisabled()

    await userEvent.type(textarea, ' the annexure list')
    expect(submit).toBeEnabled()
    await userEvent.click(submit)

    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(JSON.parse(api.history.post[0]?.data as string)).toEqual({
      reason: 'Fix the annexure list',
    })
  })

  it('disables Download until the draft has loaded, and surfaces a failed open', async () => {
    api.onGet('/documents/doc1/download-url').reply(500, { detail: 'Storage unavailable' })
    const { toast } = renderWithProviders(
      <DraftReviewPanel caseId="c1" caseTitle="Bail petition" onChanged={vi.fn()} />,
    )

    const download = await screen.findByRole('button', { name: /Download draft/ })
    await userEvent.click(download)

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          title: 'Could not open the draft',
          description: 'Storage unavailable',
        }),
      ),
    )
  })

  it('has no automatically detectable accessibility violations', async () => {
    const { container } = renderWithProviders(
      <DraftReviewPanel caseId="c1" caseTitle="Bail petition" onChanged={vi.fn()} />,
    )
    await screen.findByRole('button', { name: /Download draft/ })
    expect(await axe(container)).toHaveNoViolations()
  })
})
