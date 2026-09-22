import { useMutation } from '@tanstack/react-query'
import { CreditCard } from 'lucide-react'
import { useState } from 'react'

import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast-context'
import { useRazorpayCheckout } from '@/hooks/use-razorpay'
import { getErrorMessage } from '@/lib/errors'
import { formatCurrency } from '@/lib/utils'
import type { PaymentOrderResponse } from '@/types/api'

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
}

export function PaymentActionCard({
  createOrder,
  title,
  description,
  amountInr,
  initiallyConfirming = false,
  onPaid,
}: Props) {
  const { user } = useAuth()
  const { toast } = useToast()
  const openCheckout = useRazorpayCheckout()
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(initiallyConfirming)

  const { mutate, isPending } = useMutation({
    mutationFn: createOrder,
    onSuccess: async (order) => {
      await openCheckout({
        order,
        name: 'Advocate Filing',
        description: title,
        userEmail: user?.email,
        userName: user?.full_name,
        onSuccess: () => {
          setAwaitingConfirmation(true)
          onPaid()
        },
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

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
          <CreditCard className="size-5" strokeWidth={1.75} />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">{title}</h3>
          <p className="text-muted mt-0.5 text-sm">{description}</p>
          {awaitingConfirmation ? (
            <p className="text-muted text-label mt-3">
              Confirming your payment&hellip; this page will update automatically.
            </p>
          ) : (
            <Button
              className="mt-3"
              size="sm"
              loading={isPending}
              disabled={amountInr === undefined}
              onClick={() => mutate()}
            >
              {amountInr === undefined ? 'Pay' : `Pay ${formatCurrency(amountInr)}`}
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
