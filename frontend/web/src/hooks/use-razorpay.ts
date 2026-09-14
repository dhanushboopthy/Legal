import { useCallback } from 'react'

import type { PaymentOrderResponse } from '@/types/api'

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void }
  }
}

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'
let scriptPromise: Promise<void> | null = null

function loadRazorpayScript(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Razorpay checkout script'))
    document.body.appendChild(script)
  })
  return scriptPromise
}

interface OpenCheckoutOptions {
  order: PaymentOrderResponse
  name: string
  description: string
  userEmail?: string
  userName?: string
  onSuccess: () => void
  onDismiss?: () => void
}

export function useRazorpayCheckout() {
  return useCallback(async (opts: OpenCheckoutOptions) => {
    await loadRazorpayScript()
    const rzp = new window.Razorpay({
      key: opts.order.razorpay_key_id,
      order_id: opts.order.razorpay_order_id,
      amount: opts.order.amount_paise,
      currency: opts.order.currency,
      name: opts.name,
      description: opts.description,
      prefill: { name: opts.userName, email: opts.userEmail },
      // Payments are confirmed server-side by the Razorpay webhook, never by
      // this callback — the caller should poll the case/payment status
      // rather than trust this handler firing.
      handler: () => opts.onSuccess(),
      modal: { ondismiss: opts.onDismiss },
    })
    rzp.open()
  }, [])
}
