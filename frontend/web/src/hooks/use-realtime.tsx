import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { useAuth } from '@/auth/auth-context'
import { RealtimeContext } from '@/hooks/realtime-context'
import { applyEvent, reconnectDelay, type ServerEvent } from '@/hooks/realtime-events'
import { getSocketTicket } from '@/lib/api/realtime'

// A socket the server pushes events down, so a message or a status change shows
// up in a moment instead of on the next poll. It is an accelerator only: every
// screen still polls, more slowly while this is connected, and nothing depends
// on it being up.
//
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!userId) return
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let stopped = false

    const scheduleReconnect = () => {
      if (stopped) return
      timer = setTimeout(() => void open(), reconnectDelay(attempt))
      attempt += 1
    }

    const open = async () => {
      try {
        const ticket = await getSocketTicket()
        if (stopped) return
        const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const url = `${scheme}://${window.location.host}/api/ws?ticket=${encodeURIComponent(ticket)}`
        const ws = new WebSocket(url)
        socket = ws
        ws.onmessage = (message) => {
          let event: ServerEvent
          try {
            event = JSON.parse(String(message.data)) as ServerEvent
          } catch {
            return
          }
          if (event.type === 'ready') {
            attempt = 0
            setConnected(true)
          } else if (event.type !== 'ping') {
            applyEvent(queryClient, event)
          }
        }
        ws.onclose = () => {
          if (socket === ws) socket = null
          setConnected(false)
          scheduleReconnect()
        }
        ws.onerror = () => ws.close()
      } catch {
        scheduleReconnect()
      }
    }

    // Coming back online (or back to the tab) shouldn't wait out a long backoff.
    const retryNow = () => {
      if (socket || stopped) return
      clearTimeout(timer)
      attempt = 0
      void open()
    }
    window.addEventListener('online', retryNow)

    void open()
    return () => {
      stopped = true
      clearTimeout(timer)
      window.removeEventListener('online', retryNow)
      if (socket) {
        socket.onclose = null
        socket.close()
      }
      setConnected(false)
    }
  }, [queryClient, userId])

  const value = useMemo(() => ({ connected }), [connected])
  return <RealtimeContext value={value}>{children}</RealtimeContext>
}
