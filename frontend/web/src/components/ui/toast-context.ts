import { createContext, useContext } from 'react'

export interface ToastItem {
  id: number
  title: string
  description?: string
  variant: 'success' | 'error'
}

export interface ToastContextValue {
  toast: (item: Omit<ToastItem, 'id'>) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
