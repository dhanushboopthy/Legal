import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NewCasePage } from '@/features/cases/new-case-page'
import { apiClient } from '@/lib/api-client'
import { LAWYER_PERMISSIONS, makeUser, renderWithProviders } from '@/test/render-helpers'
import type { CaseOut, DocumentOut, UploadRules } from '@/types/api'

const { openCheckout } = vi.hoisted(() => ({ openCheckout: vi.fn() }))
vi.mock('@/hooks/use-razorpay', () => ({ useRazorpayCheckout: () => openCheckout }))

const RULES: UploadRules = {
  max_files: 10,
  max_file_size_mb: 25,
  max_case_size_mb: 100,
  accepted: {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  },
}

const draftCase = (over: Partial<CaseOut> = {}): CaseOut => ({
  id: 'c1',
  junior_lawyer_id: 'u1',
  case_number: 'LF-2026-0001',
  title: 'Bail petition',
  case_type: 'Criminal',
  court: null,
  description: null,
  note: null,
  status: 'draft',
  rejection_reason: null,
  hold_reason: null,
  revision_count: 0,
  created_at: '2026-09-15T10:00:00Z',
  updated_at: '2026-09-15T10:00:00Z',
  ...over,
})

const file = (name: string, size = 2000) => new File([new Uint8Array(size)], name)

let api: MockAdapter
let storage: MockAdapter
// storage_key -> what was uploaded, so confirm-batch can answer for real.
let uploadedSizes: Map<string, number>

beforeEach(() => {
  api = new MockAdapter(apiClient)
  storage = new MockAdapter(axios)
  uploadedSizes = new Map()
  openCheckout.mockReset()
  openCheckout.mockResolvedValue(undefined)

  api.onGet('/config/pricing').reply(200, {
    review_fee_inr: 150,
    quote_min_inr: 100,
    quote_max_inr: 100000,
  })
  api.onGet('/config/uploads').reply(200, RULES)
  api.onGet('/cases').reply(200, [])
  api.onPost('/cases').reply(200, draftCase())
  api.onPatch('/cases/c1').reply(200, draftCase())
  api.onPost('/cases/c1/submit').reply(200, draftCase({ status: 'submitted' }))
  api.onPost('/cases/c1/review-payment').reply(200, {
    payment_id: 'p1',
    razorpay_order_id: 'order_1',
    razorpay_key_id: 'rzp_test',
    amount_paise: 15000,
    currency: 'INR',
  })
  api.onPost('/documents/upload-urls').reply((config) => {
    const body = JSON.parse(config.data) as { files: { filename: string; size: number }[] }
    return [
      200,
      {
        files: body.files.map((f, i) => {
          const key = `cases/c1/${f.filename}`
          uploadedSizes.set(key, f.size)
          return {
            ...f,
            content_type: 'x',
            storage_key: key,
            upload_url: `https://store.test/${f.filename}?i=${i}`,
            expires_in_seconds: 300,
          }
        }),
      },
    ]
  })
  api.onPost('/documents/confirm-batch').reply((config) => {
    const body = JSON.parse(config.data) as {
      files: { storage_key: string; original_filename: string }[]
    }
    return [
      200,
      {
        confirmed: body.files.map((f, i) => ({
          id: `d-${f.original_filename}-${i}`,
          case_id: 'c1',
          type: 'original',
          version: 1,
          original_filename: f.original_filename,
          size_bytes: uploadedSizes.get(f.storage_key) ?? 0,
          content_type: 'x',
          page_count: null,
          uploaded_by: 'u1',
          created_at: '2026-09-15T10:00:00Z',
          locked: false,
        })),
        rejected: [],
      },
    ]
  })
  storage.onPut(/store\.test/).reply(200)
})

afterEach(() => {
  cleanup()
  api.restore()
  storage.restore()
})

function renderPage(route = '/cases/new') {
  return renderWithProviders(
    <Routes>
      <Route path="/cases/new" element={<NewCasePage />} />
      <Route path="/cases/:id" element={<p>the case page</p>} />
      <Route path="/" element={<p>the cases list</p>} />
    </Routes>,
    { user: makeUser(LAWYER_PERMISSIONS), route },
  )
}

const posts = () => api.history.post.map((r) => r.url)
const chooseFiles = (files: File[], user: UserEvent) =>
  user.upload(screen.getByTestId('file-input'), files)

async function waitForForm() {
  return screen.findByRole('button', { name: /choose files/i })
}

describe('NewCasePage', () => {
  it('puts the fee from the server on the button that spends it', async () => {
    renderPage()
    await waitForForm()
    // 150, not the 100 that is the default: nothing here is hard-coded.
    expect(screen.getByRole('button', { name: 'Submit and pay ₹150' })).toBeInTheDocument()
  })

  it('uploads five mixed files in one go, then submits and opens the payment', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitForForm()

    await chooseFiles(
      [
        file('petition.pdf'),
        file('notes.docx'),
        file('old.doc'),
        file('scan.png'),
        file('photo.jpg'),
      ],
      user,
    )
    expect(screen.getByLabelText('Files to submit').querySelectorAll('li')).toHaveLength(5)
    // The title starts as the first file's name.
    expect(screen.getByLabelText('Case title')).toHaveValue('petition')

    await user.selectOptions(screen.getByLabelText('Case type'), 'Civil')
    await user.click(screen.getByRole('button', { name: 'Submit and pay ₹150' }))

    await waitFor(() => expect(openCheckout).toHaveBeenCalledTimes(1))
    expect(posts()).toEqual([
      '/cases',
      '/documents/upload-urls',
      '/documents/confirm-batch',
      '/cases/c1/submit',
      '/cases/c1/review-payment',
    ])
    // Every file was signed for in one request and PUT to storage on its own.
    const signed = JSON.parse(api.history.post[1]?.data).files.map(
      (f: { filename: string }) => f.filename,
    )
    expect(signed).toEqual(['petition.pdf', 'notes.docx', 'old.doc', 'scan.png', 'photo.jpg'])
    expect(storage.history.put).toHaveLength(5)
    expect(openCheckout.mock.calls[0]?.[0].order.amount_paise).toBe(15000)
  })

  it('sends the checkout to the case page when it is dismissed or paid', async () => {
    const user = userEvent.setup()
    openCheckout.mockImplementation(async ({ onDismiss }: { onDismiss: () => void }) => onDismiss())
    renderPage()
    await waitForForm()
    await chooseFiles([file('petition.pdf')], user)
    await user.selectOptions(screen.getByLabelText('Case type'), 'Civil')
    await user.click(screen.getByRole('button', { name: /submit and pay/i }))

    expect(await screen.findByText('the case page')).toBeInTheDocument()
  })

  it('refuses a file that cannot be accepted before anything uploads', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderPage()
    await waitForForm()

    await chooseFiles([file('virus.exe'), file('huge.pdf', 26 * 1024 * 1024)], user)

    const alerts = screen.getAllByRole('alert').map((a) => a.textContent)
    expect(alerts.join(' ')).toContain(
      '"virus.exe" isn\'t an accepted file type. Use PDF, DOC, DOCX, PNG or JPG.',
    )
    expect(alerts.join(' ')).toContain('"huge.pdf" is larger than 25 MB.')
    expect(screen.queryByLabelText('Files to submit')).toBeNull()
    expect(api.history.post).toHaveLength(0)
  })

  it('will not submit without a file or a case type, and says what is missing', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitForForm()

    await user.click(screen.getByRole('button', { name: /submit and pay/i }))

    expect(await screen.findByText('Add at least one file.')).toBeInTheDocument()
    expect(screen.getByText('Choose a case type')).toBeInTheDocument()
    expect(screen.getByText('At least 3 characters')).toBeInTheDocument()
    expect(api.history.post).toHaveLength(0)
  })

  it('retries a failed upload on the same case, with only that file, and never creates a second case', async () => {
    const user = userEvent.setup()
    storage.reset()
    storage.onPut(/scan\.png/).replyOnce(403)
    storage.onPut(/store\.test/).reply(200)
    renderPage()
    await waitForForm()
    await chooseFiles([file('petition.pdf'), file('scan.png')], user)
    await user.selectOptions(screen.getByLabelText('Case type'), 'Civil')

    await user.click(screen.getByRole('button', { name: 'Submit and pay ₹150' }))

    // The good file went through; the failed one says why and can be retried.
    expect(await screen.findByText(/upload link expired/i)).toBeInTheDocument()
    expect(posts()).toEqual(['/cases', '/documents/upload-urls', '/documents/confirm-batch'])
    expect(openCheckout).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Retry scan.png' }))
    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(2))
    const retryRequest = JSON.parse(api.history.post[3]?.data)
    expect(retryRequest.files.map((f: { filename: string }) => f.filename)).toEqual(['scan.png'])

    // Now the main button finishes the job: same case, no duplicate.
    await user.click(screen.getByRole('button', { name: 'Submit and pay ₹150' }))
    await waitFor(() => expect(openCheckout).toHaveBeenCalledTimes(1))
    expect(posts().filter((url) => url === '/cases')).toHaveLength(1)
    expect(api.history.patch.map((r) => r.url)).toEqual(['/cases/c1'])
  })

  it('offers "Retry and pay" when the main button is pressed with a failed file', async () => {
    const user = userEvent.setup()
    storage.reset()
    storage.onPut(/store\.test/).replyOnce(403)
    renderPage()
    await waitForForm()
    await chooseFiles([file('petition.pdf')], user)
    await user.selectOptions(screen.getByLabelText('Case type'), 'Civil')
    await user.click(screen.getByRole('button', { name: /submit and pay/i }))

    // The store recovers before the person presses the retry button.
    const retry = await screen.findByRole('button', { name: 'Retry and pay ₹150' })
    storage.onPut(/store\.test/).reply(200)
    await user.click(retry)
    await waitFor(() => expect(openCheckout).toHaveBeenCalled())
    expect(posts().filter((url) => url === '/cases')).toHaveLength(1)
  })

  it('shows what the server refused about a file, on that file', async () => {
    const user = userEvent.setup()
    api.onPost('/documents/confirm-batch').reply(200, {
      confirmed: [],
      rejected: [
        {
          storage_key: 'cases/c1/fake.png',
          original_filename: 'fake.png',
          reason: "That doesn't look like a real .png file",
        },
      ],
    })
    renderPage()
    await waitForForm()
    await chooseFiles([file('fake.png')], user)
    await user.selectOptions(screen.getByLabelText('Case type'), 'Civil')
    await user.click(screen.getByRole('button', { name: /submit and pay/i }))

    expect(await screen.findByText("That doesn't look like a real .png file")).toBeInTheDocument()
    expect(posts()).not.toContain('/cases/c1/submit')
    expect(openCheckout).not.toHaveBeenCalled()
  })

  it('continues an unfinished draft instead of starting another', async () => {
    const user = userEvent.setup()
    api.onGet('/cases').reply(200, [draftCase({ note: 'Urgent' })])
    api.onGet('/documents/case/c1').reply(200, [
      {
        id: 'd1',
        case_id: 'c1',
        type: 'original',
        version: 1,
        original_filename: 'fir.pdf',
        size_bytes: 4096,
        content_type: 'application/pdf',
        page_count: null,
        uploaded_by: 'u1',
        created_at: '2026-09-15T10:00:00Z',
        locked: false,
      } satisfies DocumentOut,
    ])
    renderPage()

    expect(await screen.findByText('Continuing your unfinished draft.')).toBeInTheDocument()
    expect(screen.getByLabelText('Case title')).toHaveValue('Bail petition')
    expect(screen.getByLabelText('Case type')).toHaveValue('Criminal')
    expect(screen.getByLabelText('Note for the advocate (optional)')).toHaveValue('Urgent')
    expect(screen.getByText('fir.pdf')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Submit and pay ₹150' }))
    await waitFor(() => expect(openCheckout).toHaveBeenCalledTimes(1))
    // The file was already there, so nothing is uploaded and no case is created.
    expect(posts()).toEqual(['/cases/c1/submit', '/cases/c1/review-payment'])
  })

  it('goes straight to payment when a lost response hid that the case was already submitted', async () => {
    const user = userEvent.setup()
    api.onGet('/cases').reply(200, [draftCase()])
    api.onGet('/documents/case/c1').reply(200, [])
    api.onPatch('/cases/c1').reply(409, { detail: 'already moved on' })
    api.onGet('/cases/c1').reply(200, draftCase({ status: 'submitted' }))
    renderPage()
    await screen.findByText('Continuing your unfinished draft.')
    await chooseFiles([file('petition.pdf')], user)
    await user.click(screen.getByRole('button', { name: /submit and pay/i }))

    await waitFor(() => expect(openCheckout).toHaveBeenCalledTimes(1))
    expect(posts()).not.toContain('/cases')
  })

  it('discards a draft only after confirming, and names it', async () => {
    const user = userEvent.setup()
    api.onGet('/cases').reply(200, [draftCase()])
    api.onGet('/documents/case/c1').reply(200, [])
    api.onDelete('/cases/c1').reply(204)
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/"Bail petition"/)).toBeInTheDocument()
    expect(api.history.delete).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }))
    expect(await screen.findByText('the cases list')).toBeInTheDocument()
    expect(api.history.delete.map((r) => r.url)).toEqual(['/cases/c1'])
  })

  it('says so when the form cannot load, instead of showing a form without its fee', async () => {
    api.onGet('/config/pricing').reply(500, { detail: 'Pricing is unavailable' })
    renderPage()

    expect(await screen.findByText("Couldn't load the new case form")).toBeInTheDocument()
    expect(screen.getByText('Pricing is unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit and pay/i })).toBeNull()
  })

  it('still lets a case be paid for from the case page if checkout cannot start', async () => {
    const user = userEvent.setup()
    api.onPost('/cases/c1/review-payment').reply(502, { detail: 'Payment provider unavailable' })
    const { toast } = renderPage()
    await waitForForm()
    await chooseFiles([file('petition.pdf')], user)
    await user.selectOptions(screen.getByLabelText('Case type'), 'Civil')
    await user.click(screen.getByRole('button', { name: /submit and pay/i }))

    expect(await screen.findByText('the case page')).toBeInTheDocument()
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'error',
        description: expect.stringContaining('pay from the case page'),
      }),
    )
  })
})
