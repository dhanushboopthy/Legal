import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, CreditCard } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast-context'
import { useRazorpayCheckout } from '@/hooks/use-razorpay'
import { getErrorMessage } from '@/lib/errors'
import { reconcilePayment } from '@/lib/api/payments'
import { formatCurrency } from '@/lib/utils'
import type { PaymentOrderResponse } from '@/types/api'

const SLOW_AFTER_MS = 60_000

type CardState = 'idle' | 'confirming' | 'slow' | 'failed'

interface Props {
  createOrder: () => Promise<PaymentOrderResponse>
  title: string
  description: string
  // Shown on the button: nobody should be asked to pay without seeing the
  // amount. Comes from the server; the button waits until it has it.
  amountInr: number | undefined
  // The fee was paid moments ago (in the checkout that opened from the
  // new-case page), so start out waiting for it to be confirmed.
  initiallyConfirming?: boolean
  onPaid: () => void
  // What is being paid for (e.g. the locked draft's details), shown above the button.
  children?: ReactNode
  buttonLabel?: (amount: string) => string
}

export function PaymentActionCard({
  createOrder,
  title,
  description,
  amountInr,
  initiallyConfirming = false,
  onPaid,
  children,
  buttonLabel = (amount) => `Pay ${amount}`,
}: Props) {
  const { user } = useAuth()
  const { toast } = useToast()
  const openCheckout = useRazorpayCheckout()
  const [state, setState] = useState<CardState>(initiallyConfirming ? 'confirming' : 'idle')
  const [paymentId, setPaymentId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (state !== 'confirming') return
    timer.current = setTimeout(() => setState('slow'), SLOW_AFTER_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [state])

  const { mutate, isPending } = useMutation({
    mutationFn: createOrder,
    onSuccess: async (order) => {
      setPaymentId(order.payment_id)
      await openCheckout({
        order,
        name: 'Advocate Filing',
        description: title,
        userEmail: user?.email,
        userName: user?.full_name,
        onSuccess: () => {
          setState('confirming')
          onPaid()
        },
        onFailed: () => setState('failed'),
      })
    },
    onError: (err) => {
      toast({
        variant: 'error',
        title: 'Could not start payment',
        description: getErrorMessage(err),
      })
    },
  })

  const check = useMutation({
    mutationFn: () => reconcilePayment(paymentId!),
    onSuccess: (payment) => {
      if (payment.status === 'paid') {
        onPaid()
      } else if (payment.status === 'failed') {
        setState('failed')
      } else {
        toast({ variant: 'success', title: 'Still pending', description: 'Check again shortly.' })
      }
    },
    onError: (err) =>
      toast({
        variant: 'error',
        title: "Couldn't check payment status",
        description: getErrorMessage(err),
      }),
  })

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div
          className={
            state === 'failed'
              ? 'flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
              : 'flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
          }
        >
          {state === 'failed' ? (
            <AlertTriangle className="size-5" strokeWidth={1.75} />
          ) : (
            <CreditCard className="size-5" strokeWidth={1.75} />
          )}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">{title}</h3>
          <p className="text-muted mt-0.5 text-sm">{description}</p>
          {children}

          {state === 'idle' && (
            <Button
              className="mt-4"
              loading={isPending}
              disabled={amountInr === undefined}
              onClick={() => mutate()}
            >
              {amountInr === undefined ? 'Pay' : buttonLabel(formatCurrency(amountInr))}
            </Button>
          )}

          {state === 'confirming' && (
            <p className="text-muted text-label mt-3">
              Confirming your payment&hellip; this page will update automatically.
            </p>
          )}

          {state === 'slow' && (
            <div className="mt-3">
              <p className="text-muted text-label">
                Taking longer than usual. Your payment is safe.
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="secondary"
                loading={check.isPending}
                onClick={() => check.mutate()}
              >
                Check status
              </Button>
            </div>
          )}

          {state === 'failed' && (
            <div className="mt-3">
              <p className="text-danger-ink text-label">
                That payment didn&apos;t go through. Nothing was charged.
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="secondary"
                loading={isPending}
                onClick={() => mutate()}
              >
                Retry payment
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
