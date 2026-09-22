import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatThread } from '@/features/chat/chat-thread'
import { apiClient } from '@/lib/api-client'
import { LAWYER_PERMISSIONS, makeUser, renderWithProviders } from '@/test/render-helpers'
import type { MessageOut, MessagePage, UploadRules } from '@/types/api'

const { openDocument } = vi.hoisted(() => ({ openDocument: vi.fn() }))
vi.mock('@/lib/download', () => ({ openDocument }))

const ME = 'u-me'
const RULES: UploadRules = {
  max_files: 10,
  max_file_size_mb: 25,
  max_case_size_mb: 100,
  accepted: { '.pdf': 'application/pdf', '.png': 'image/png', '.docx': 'application/x' },
}

let nextId = 100
const msg = (over: Partial<MessageOut> = {}): MessageOut => ({
  id: ++nextId,
  case_id: 'c1',
  sender_id: 'u-them',
  sender_name: 'Adv. Rao',
  kind: 'text',
  body: 'hello',
  meta: {},
  attachments: [],
  client_id: null,
  created_at: new Date().toISOString(),
  ...over,
})
const pageOf = (messages: MessageOut[], over: Partial<MessagePage> = {}): MessagePage => ({
  messages,
  has_more: false,
  my_last_read_id: messages.at(-1)?.id ?? 0,
  other_last_read_id: 0,
  open: true,
  ...over,
})

let api: MockAdapter
let sent: { client_id: string; body?: string; attachments?: unknown[] }[]
beforeEach(() => {
  api = new MockAdapter(apiClient)
  sent = []
  openDocument.mockReset()
  api.onGet('/config/uploads').reply(200, RULES)
  api.onPost('/cases/c1/read').reply(200, {})
  // Echo whatever is sent back as a stored message.
  api.onPost('/cases/c1/messages').reply((config) => {
    const body = JSON.parse(config.data)
    sent.push(body)
    return [
      201,
      msg({ sender_id: ME, sender_name: 'Me', body: body.body ?? null, client_id: body.client_id }),
    ]
  })
})
afterEach(() => {
  cleanup()
  api.restore()
  vi.unstubAllGlobals()
})

const serve = (page: MessagePage) => api.onGet('/cases/c1/messages').reply(200, page)
const mount = () =>
  renderWithProviders(<ChatThread caseId="c1" ownId={ME} />, {
    user: makeUser(LAWYER_PERMISSIONS, { id: ME }),
  })
const desktop = (matches: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
const composer = () => screen.findByRole('textbox', { name: 'Message' })

describe('reading the thread', () => {
  it('shows what was said by each side, the lines the server wrote, and the quote card', async () => {
    serve(
      pageOf([
        msg({ kind: 'system', sender_id: null, body: 'The advocate accepted this case.' }),
        msg({ body: 'Please share the FIR copy' }),
        msg({ sender_id: ME, sender_name: 'Me', body: 'Sharing it now' }),
        msg({
          kind: 'quote',
          sender_id: null,
          body: 'Quote sent: ₹2,500',
          meta: {
            amount_inr: 2500,
            updated: false,
            note: 'Includes annexures',
            draft: { filename: 'bail.pdf', page_count: 8, size_bytes: 2048 },
          },
        }),
      ]),
    )
    mount()

    expect(await screen.findByText('The advocate accepted this case.')).toBeInTheDocument()
    expect(screen.getByText('Please share the FIR copy')).toBeInTheDocument()
    expect(screen.getByText('Sharing it now')).toBeInTheDocument()
    expect(screen.getByText('₹2,500')).toBeInTheDocument()
    expect(screen.getByText(/bail\.pdf · 8 pages · 2 KB/)).toBeInTheDocument()
    expect(screen.getByText(/Includes annexures/)).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('shows an error with a retry, not an empty chat, when the thread cannot load', async () => {
    api.onGet('/cases/c1/messages').replyOnce(500, { detail: 'Boom from the server' })
    serve(pageOf([msg({ body: 'back again' })]))
    mount()

    expect(await screen.findByText("Couldn't load the chat")).toBeInTheDocument()
    expect(screen.getByText('Boom from the server')).toBeInTheDocument()
    expect(screen.queryByText(/No messages yet/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('back again')).toBeInTheDocument()
  })

  it('invites the first message on a chat with nothing in it', async () => {
    serve(pageOf([]))
    mount()
    expect(await screen.findByText(/No messages yet/)).toBeInTheDocument()
  })

  it('renders message text as text, with links that open safely', async () => {
    serve(pageOf([msg({ body: '<img src=x onerror=alert(1)> see https://example.com/fir.' })]))
    const { container } = mount()

    const link = await screen.findByRole('link', { name: 'https://example.com/fir' })
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('opens a shared file when it is tapped', async () => {
    serve(
      pageOf([
        msg({
          kind: 'file',
          body: null,
          attachments: [
            {
              document_id: 'd1',
              filename: 'fir.pdf',
              size_bytes: 4096,
              content_type: 'application/pdf',
            },
          ],
        }),
      ]),
    )
    mount()
    await userEvent.click(await screen.findByRole('button', { name: /fir\.pdf/ }))
    expect(openDocument).toHaveBeenCalledWith('d1')
  })

  it('says when the chat is over and takes the composer away', async () => {
    serve(pageOf([msg({ body: 'Thanks' })], { open: false }))
    mount()
    expect(await screen.findByText(/chat is read-only/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull()
  })

  it('pages back through history from the top', async () => {
    const older = [msg({ body: 'the very first message' })]
    api
      .onGet('/cases/c1/messages')
      .reply((config) =>
        config.params?.before
          ? [200, pageOf(older, { has_more: false })]
          : [200, pageOf([msg({ body: 'recent' })], { has_more: true })],
      )
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Load earlier messages' }))
    expect(await screen.findByText('the very first message')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).toBeNull()
    expect(screen.getByText('recent')).toBeInTheDocument()
  })
})

describe('unread and seen', () => {
  it('puts a divider before the first unread message and then marks the thread read', async () => {
    const seen = msg({ body: 'already read' })
    const unread = msg({ body: 'not read yet' })
    serve(pageOf([seen, unread], { my_last_read_id: seen.id }))
    mount()

    expect(await screen.findByText('not read yet')).toBeInTheDocument()
    const divider = screen.getByRole('separator', { name: 'New messages' })
    expect(divider.nextElementSibling).toHaveTextContent('not read yet')
    await waitFor(() => expect(api.history.post.map((r) => r.url)).toContain('/cases/c1/read'))
    expect(JSON.parse(api.history.post.find((r) => r.url === '/cases/c1/read')!.data)).toEqual({
      last_read_message_id: unread.id,
    })
  })

  it('does not draw a divider when everything has been read', async () => {
    serve(pageOf([msg({ body: 'old' })]))
    mount()
    await screen.findByText('old')
    expect(screen.queryByRole('separator', { name: 'New messages' })).toBeNull()
  })

  it('shows Seen under my last message once the other side has read it', async () => {
    const mine = msg({ sender_id: ME, sender_name: 'Me', body: 'did you get it?' })
    serve(pageOf([mine], { other_last_read_id: mine.id }))
    mount()
    expect(await screen.findByText('Seen')).toBeInTheDocument()
  })

  it('does not show Seen before they have', async () => {
    const mine = msg({ sender_id: ME, sender_name: 'Me', body: 'did you get it?' })
    serve(pageOf([mine], { other_last_read_id: mine.id - 1 }))
    mount()
    await screen.findByText('did you get it?')
    expect(screen.queryByText('Seen')).toBeNull()
  })

  it('picks up a new message from the server without a reload, asking only for what is new', async () => {
    const first = msg({ body: 'first' })
    const later = msg({ body: 'arrived later' })
    let calls = 0
    api.onGet('/cases/c1/messages').reply((config) => {
      calls += 1
      return config.params?.after ? [200, pageOf([later])] : [200, pageOf([first])]
    })
    const { queryClient } = mount()
    await screen.findByText('first')

    await act(
      async () => void (await queryClient.invalidateQueries({ queryKey: ['thread', 'c1'] })),
    )

    expect(await screen.findByText('arrived later')).toBeInTheDocument()
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(calls).toBe(2)
    expect(
      api.history.get.filter((r) => r.url === '/cases/c1/messages').at(-1)?.params,
    ).toMatchObject({
      after: first.id,
    })
  })
})

describe('sending', () => {
  it('shows the message at once and posts it with an id the browser made', async () => {
    desktop(true)
    serve(pageOf([]))
    mount()
    const box = await composer()

    await userEvent.type(box, 'Are you free to talk?{Enter}')

    expect(await screen.findByText('Are you free to talk?')).toBeInTheDocument()
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.body).toBe('Are you free to talk?')
    expect(sent[0]?.client_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(box).toHaveValue('')
    // Once the server has it, the "Sending…" state is gone and it is not shown twice.
    await waitFor(() => expect(screen.queryByText('Sending…')).toBeNull())
    expect(screen.getAllByText('Are you free to talk?')).toHaveLength(1)
  })

  it('sends on Enter at a desktop, and lets Shift+Enter make a new line', async () => {
    desktop(true)
    serve(pageOf([]))
    mount()
    const box = await composer()
    await userEvent.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(sent).toHaveLength(0)
    expect(box).toHaveValue('line one\nline two')
    await userEvent.type(box, '{Enter}')
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.body).toBe('line one\nline two')
  })

  it('on a phone, Enter is a new line and only the Send button sends', async () => {
    desktop(false)
    serve(pageOf([]))
    mount()
    const box = await composer()
    await userEvent.type(box, 'hello{Enter}there')
    expect(sent).toHaveLength(0)
    expect(box).toHaveValue('hello\nthere')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(sent).toHaveLength(1))
  })

  it('will not send an empty message', async () => {
    serve(pageOf([]))
    mount()
    await composer()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    await userEvent.type(await composer(), '   ')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  })

  it('counts characters from 3,500 and stops at 4,000', async () => {
    serve(pageOf([]))
    mount()
    const box = (await composer()) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'x'.repeat(3499) } })
    expect(screen.queryByText(/\/ 4,000/)).toBeNull()
    fireEvent.change(box, { target: { value: 'x'.repeat(3600) } })
    expect(screen.getByText('3,600 / 4,000')).toBeInTheDocument()
    expect(box).toHaveAttribute('maxlength', '4000')
  })

  it('keeps a failed message, says why, and a retry sends the same id — one message in the end', async () => {
    const user = userEvent.setup()
    desktop(true)
    serve(pageOf([]))
    api.reset()
    api.onGet('/config/uploads').reply(200, RULES)
    api.onGet('/cases/c1/messages').reply(200, pageOf([]))
    api.onPost('/cases/c1/read').reply(200, {})
    const attempts: string[] = []
    api.onPost('/cases/c1/messages').reply((config) => {
      const body = JSON.parse(config.data)
      attempts.push(body.client_id)
      return attempts.length === 1
        ? [503, { detail: 'Please try again shortly' }]
        : [
            201,
            msg({ sender_id: ME, sender_name: 'Me', body: body.body, client_id: body.client_id }),
          ]
    })
    mount()
    await user.type(await composer(), 'Important point{Enter}')

    const failed = await screen.findByRole('alert')
    expect(failed).toHaveTextContent('Not sent. Please try again shortly')
    await user.click(within(failed).getByRole('button', { name: /Retry/ }))

    await waitFor(() => expect(attempts).toHaveLength(2))
    expect(attempts[1]).toBe(attempts[0]) // the same id: the server posts it once however often this is tried
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getAllByText('Important point')).toHaveLength(1)
  })

  it('lets a failed message be removed', async () => {
    const user = userEvent.setup()
    desktop(true)
    api.reset()
    api.onGet('/config/uploads').reply(200, RULES)
    api.onGet('/cases/c1/messages').reply(200, pageOf([]))
    api.onPost('/cases/c1/messages').reply(500, { detail: 'nope' })
    mount()
    await user.type(await composer(), 'never mind{Enter}')
    await user.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: 'Remove' }),
    )
    expect(screen.queryByText('never mind')).toBeNull()
  })

  it('retries once by itself when the connection comes back, without duplicating', async () => {
    const user = userEvent.setup()
    desktop(true)
    api.reset()
    api.onGet('/config/uploads').reply(200, RULES)
    api.onGet('/cases/c1/messages').reply(200, pageOf([]))
    api.onPost('/cases/c1/read').reply(200, {})
    const attempts: string[] = []
    api.onPost('/cases/c1/messages').networkErrorOnce() // the first attempt is lost on the way
    api.onPost('/cases/c1/messages').reply((config) => {
      const body = JSON.parse(config.data)
      attempts.push(body.client_id)
      return [
        201,
        msg({ sender_id: ME, sender_name: 'Me', body: body.body, client_id: body.client_id }),
      ]
    })
    mount()
    await user.type(await composer(), 'sent from a tunnel{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Not sent')
    expect(attempts).toHaveLength(0) // the first attempt never reached the server

    act(() => void window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(attempts).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())

    act(() => void window.dispatchEvent(new Event('online'))) // a second "online" must not send again
    await new Promise((r) => setTimeout(r, 30))
    expect(attempts).toHaveLength(1)
    expect(screen.getAllByText('sent from a tunnel')).toHaveLength(1)
  })

  it('uploads files first, then sends the message with them', async () => {
    const user = userEvent.setup()
    desktop(true)
    serve(pageOf([]))
    api.onPost('/cases/c1/attachments/upload-urls').reply((config) => {
      const { files } = JSON.parse(config.data)
      return [
        200,
        {
          files: files.map((f: { filename: string; size: number }) => ({
            ...f,
            content_type: 'x',
            storage_key: `cases/c1/${f.filename}`,
            upload_url: `https://store.test/${f.filename}`,
            expires_in_seconds: 300,
          })),
        },
      ]
    })
    const storage = new MockAdapter((await import('axios')).default)
    storage.onPut(/store\.test/).reply(200)
    mount()
    await composer()

    await user.upload(screen.getByTestId('chat-file-input'), [
      new File(['%PDF-'], 'fir.pdf', { type: 'application/pdf' }),
    ])
    expect(screen.getByRole('list', { name: 'Files to send' })).toHaveTextContent('fir.pdf')
    await user.type(await composer(), 'here it is{Enter}')

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.attachments).toEqual([
      { storage_key: 'cases/c1/fir.pdf', original_filename: 'fir.pdf' },
    ])
    expect(storage.history.put).toHaveLength(1)
    storage.restore()
  })

  it('refuses a file type that is not accepted, before anything is uploaded', async () => {
    const user = userEvent.setup({ applyAccept: false })
    serve(pageOf([]))
    const { toast } = mount()
    await composer()
    await user.upload(screen.getByTestId('chat-file-input'), [new File(['x'], 'run.exe')])
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('run.exe') }),
    )
    expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull()
  })
})
