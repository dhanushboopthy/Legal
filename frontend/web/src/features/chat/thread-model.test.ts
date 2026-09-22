import { describe, expect, it } from 'vitest'

import {
  buildThread,
  dayLabel,
  lastOwnMessageId,
  mergeMessages,
  type OutgoingMessage,
} from '@/features/chat/thread-model'
import type { MessageOut } from '@/types/api'

const ME = 'me'
const THEM = 'them'
const NOW = new Date('2026-09-21T12:00:00')

let seq = 0
const msg = (over: Partial<MessageOut> & { at?: string }): MessageOut => {
  const { at, ...rest } = over
  seq += 1
  return {
    id: seq,
    case_id: 'c1',
    sender_id: THEM,
    sender_name: 'Adv. Rao',
    kind: 'text',
    body: 'hi',
    meta: {},
    attachments: [],
    client_id: null,
    created_at: at ?? '2026-09-21T10:00:00',
    ...rest,
  }
}
const outgoing = (over: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  clientId: 'k1',
  body: 'on its way',
  files: [],
  status: 'sending',
  createdAt: '2026-09-21T10:30:00',
  ...over,
})
const types = (items: ReturnType<typeof buildThread>) => items.map((i) => i.type)

describe('dayLabel', () => {
  it('says Today and Yesterday, then a date', () => {
    expect(dayLabel('2026-09-21T01:00:00', NOW)).toBe('Today')
    expect(dayLabel('2026-09-20T23:59:00', NOW)).toBe('Yesterday')
    expect(dayLabel('2026-09-10T09:00:00', NOW)).toMatch(/10 Sept?/)
    expect(dayLabel('2025-12-31T09:00:00', NOW)).toMatch(/2025/)
  })
})

describe('buildThread', () => {
  it('puts a day separator before the first message of each day', () => {
    const items = buildThread({
      messages: [msg({ at: '2026-09-20T09:00:00' }), msg({ at: '2026-09-21T09:00:00' })],
      outgoing: [],
      ownId: ME,
      unreadAfterId: null,
      now: NOW,
    })
    expect(types(items)).toEqual(['day', 'message', 'day', 'message'])
    expect(items.filter((i) => i.type === 'day').map((i) => i.type === 'day' && i.label)).toEqual([
      'Yesterday',
      'Today',
    ])
  })

  it('groups a sender’s messages within five minutes and splits them after that', () => {
    const items = buildThread({
      messages: [
        msg({ at: '2026-09-21T10:00:00' }),
        msg({ at: '2026-09-21T10:03:00' }),
        msg({ at: '2026-09-21T10:09:00' }),
      ],
      outgoing: [],
      ownId: ME,
      unreadAfterId: null,
      now: NOW,
    })
    const flags = items.flatMap((i) => (i.type === 'message' ? [[i.startsGroup, i.endsGroup]] : []))
    expect(flags).toEqual([
      [true, false],
      [false, true],
      [true, true],
    ])
  })

  it('does not group across senders, and never groups system lines or cards', () => {
    const items = buildThread({
      messages: [
        msg({ sender_id: THEM }),
        msg({ sender_id: ME }),
        msg({ kind: 'system', sender_id: null, body: 'Payment received' }),
        msg({ kind: 'quote', sender_id: null }),
        msg({ kind: 'quote', sender_id: null }),
      ],
      outgoing: [],
      ownId: ME,
      unreadAfterId: null,
      now: NOW,
    })
    const flags = items.flatMap((i) => (i.type === 'message' ? [[i.startsGroup, i.endsGroup]] : []))
    expect(flags).toEqual([
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
    ])
  })

  it('places the unread divider before the first message from someone else after the cursor', () => {
    const read = msg({ id: 10, sender_id: THEM })
    const mine = msg({ id: 11, sender_id: ME })
    const fresh = msg({ id: 12, sender_id: THEM })
    const items = buildThread({
      messages: [read, mine, fresh, msg({ id: 13, sender_id: THEM })],
      outgoing: [],
      ownId: ME,
      unreadAfterId: 10,
      now: NOW,
    })
    expect(types(items)).toEqual(['day', 'message', 'message', 'unread', 'message', 'message'])
  })

  it('has no divider when everything is read, or when only my own messages are newer', () => {
    const all = [msg({ id: 20, sender_id: THEM }), msg({ id: 21, sender_id: ME })]
    expect(
      types(buildThread({ messages: all, outgoing: [], ownId: ME, unreadAfterId: 21, now: NOW })),
    ).not.toContain('unread')
    expect(
      types(buildThread({ messages: all, outgoing: [], ownId: ME, unreadAfterId: 20, now: NOW })),
    ).not.toContain('unread')
    expect(
      types(buildThread({ messages: all, outgoing: [], ownId: ME, unreadAfterId: null, now: NOW })),
    ).not.toContain('unread')
  })

  it('shows messages still being sent after the sent ones, as mine', () => {
    const items = buildThread({
      messages: [msg({ sender_id: THEM })],
      outgoing: [outgoing()],
      ownId: ME,
      unreadAfterId: null,
      now: NOW,
    })
    const last = items.at(-1)
    expect(last?.type === 'message' && last.own && last.outgoing?.status === 'sending').toBe(true)
  })
})

describe('mergeMessages', () => {
  it('keeps one copy of each message, oldest first', () => {
    const a = msg({ id: 1 })
    const b = msg({ id: 2 })
    const c = msg({ id: 3 })
    expect(mergeMessages([b, a], [c, b]).map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('lets a newer copy replace an older one', () => {
    const merged = mergeMessages([msg({ id: 5, body: 'old' })], [msg({ id: 5, body: 'new' })])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.body).toBe('new')
  })
})

describe('lastOwnMessageId', () => {
  it('finds my newest written message, ignoring cards and other people', () => {
    const list = [
      msg({ id: 1, sender_id: ME }),
      msg({ id: 2, sender_id: THEM }),
      msg({ id: 3, sender_id: ME, kind: 'file' }),
      msg({ id: 4, sender_id: null, kind: 'system' }),
    ]
    expect(lastOwnMessageId(list, ME)).toBe(3)
    expect(lastOwnMessageId([msg({ sender_id: THEM })], ME)).toBeNull()
  })
})
