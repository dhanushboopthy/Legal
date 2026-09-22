import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/auth/auth-context'
import { useRealtime } from '@/hooks/realtime-context'
import { applyEvent, reconnectDelay } from '@/hooks/realtime-events'
import { RealtimeProvider } from '@/hooks/use-realtime'
import { apiClient } from '@/lib/api-client'
import { makeUser } from '@/test/render-helpers'

class FakeSocket {
  static all: FakeSocket[] = []
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }
  close() {
    this.closed = true
    this.onclose?.()
  }
  push(event: object) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }
}

let api: MockAdapter
let queryClient: QueryClient
let tickets = 0

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.all = []
  tickets = 0
  vi.stubGlobal('WebSocket', FakeSocket)
  api = new MockAdapter(apiClient)
  api.onPost('/ws/ticket').reply(() => [200, { ticket: `t${++tickets}`, expires_in_seconds: 30 }])
  queryClient = new QueryClient()
})
afterEach(() => {
  cleanup()
  api.restore()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function Probe() {
  return <p>{useRealtime().connected ? 'connected' : 'polling'}</p>
}

function mount() {
  const auth = { user: makeUser([]) } as unknown as AuthContextValue
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext value={auth}>
        <RealtimeProvider>
          <Probe />
        </RealtimeProvider>
      </AuthContext>
    </QueryClientProvider>,
  )
}

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)))
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

describe('RealtimeProvider', () => {
  it('connects with a fresh ticket in the URL and reports connected once the server says ready', async () => {
    mount()
    await flush()
    expect(FakeSocket.all).toHaveLength(1)
    expect(FakeSocket.all[0]?.url).toMatch(/^wss?:\/\/.+\/api\/ws\?ticket=t1$/)
    expect(screen.getByText('polling')).toBeInTheDocument()

    await act(async () => FakeSocket.all[0]?.push({ type: 'ready' }))
    expect(screen.getByText('connected')).toBeInTheDocument()
  })

  it('marks the right queries stale for each kind of event', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    mount()
    await flush()
    const socket = FakeSocket.all[0]
    await act(async () => socket?.push({ type: 'ready' }))

    await act(async () => socket?.push({ type: 'message.created', case_id: 'c1', message_id: 9 }))
    const keys = () => invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys()).toEqual(
      expect.arrayContaining([
        JSON.stringify(['thread', 'c1']),
        JSON.stringify(['cases']),
        JSON.stringify(['notifications']),
      ]),
    )

    invalidate.mockClear()
    await act(async () =>
      socket?.push({ type: 'case.status_changed', case_id: 'c1', status: 'quoted' }),
    )
    expect(keys()).toEqual(
      expect.arrayContaining([
        JSON.stringify(['cases']),
        JSON.stringify(['case', 'c1']),
        JSON.stringify(['case-documents', 'c1']),
        JSON.stringify(['case-payments', 'c1']),
      ]),
    )

    invalidate.mockClear()
    await act(async () => socket?.push({ type: 'ping' }))
    await act(async () => socket?.onmessage?.({ data: 'not json' }))
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('falls back to polling when the socket drops, and reconnects with a new ticket', async () => {
    mount()
    await flush()
    await act(async () => FakeSocket.all[0]?.push({ type: 'ready' }))

    await act(async () => FakeSocket.all[0]?.onclose?.())
    expect(screen.getByText('polling')).toBeInTheDocument()
    await advance(1_000)
    expect(FakeSocket.all).toHaveLength(2)
    expect(FakeSocket.all[1]?.url).toMatch(/ticket=t2$/) // a used ticket is never reused

    await act(async () => FakeSocket.all[1]?.push({ type: 'ready' }))
    expect(screen.getByText('connected')).toBeInTheDocument()
  })

  it('waits longer after each failed attempt, and starts over after a good connection', async () => {
    api.reset()
    api.onPost('/ws/ticket').reply(500)
    mount()
    await flush()
    expect(tickets).toBe(0)
    const calls = () => api.history.post.length
    expect(calls()).toBe(1)
    await advance(1_000) // first retry after ~0.5-1 s
    expect(calls()).toBe(2)
    await advance(1_000) // the next wait is longer (1-2 s): not yet
    expect(calls()).toBe(2)
    await advance(1_000)
    expect(calls()).toBe(3)

    api.reset()
    api.onPost('/ws/ticket').reply(() => [200, { ticket: 'ok', expires_in_seconds: 30 }])
    await advance(30_000)
    expect(FakeSocket.all).toHaveLength(1)
    await act(async () => FakeSocket.all[0]?.push({ type: 'ready' }))
    await act(async () => FakeSocket.all[0]?.onclose?.())
    await advance(1_000) // back to the shortest wait
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('stops for good when the page is left', async () => {
    const view = mount()
    await flush()
    const socket = FakeSocket.all[0]
    view.unmount()
    expect(socket?.closed).toBe(true)
    await advance(60_000)
    expect(FakeSocket.all).toHaveLength(1)
  })
})

describe('reconnectDelay', () => {
  it('doubles up to a ceiling, with jitter of at most half', () => {
    expect(reconnectDelay(0, 1)).toBe(1_000)
    expect(reconnectDelay(0, 0)).toBe(500)
    expect(reconnectDelay(3, 1)).toBe(8_000)
    expect(reconnectDelay(20, 1)).toBe(30_000)
  })
})

describe('applyEvent', () => {
  it('ignores events it does not know', () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    applyEvent(client, { type: 'something.else', case_id: 'c1' })
    expect(spy).not.toHaveBeenCalled()
  })
})
