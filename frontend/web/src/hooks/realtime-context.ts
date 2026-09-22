import { createContext, useContext } from 'react'

export interface RealtimeValue {
  // True while the event socket is up. Screens poll either way, more slowly then.
  connected: boolean
}

export const RealtimeContext = createContext<RealtimeValue>({ connected: false })

export const useRealtime = () => useContext(RealtimeContext)
