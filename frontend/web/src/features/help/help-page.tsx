import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Mail, Phone } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { BackLink } from '@/components/layout/back-link'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePageTitle } from '@/hooks/use-page-title'
import { getPricing, getSupport } from '@/lib/api/config'
import { formatCurrency } from '@/lib/utils'

export function HelpPage() {
  usePageTitle('Help')
  const { data: pricing } = useQuery({ queryKey: ['pricing'], queryFn: getPricing, staleTime: Infinity })
  const fee = pricing ? formatCurrency(pricing.review_fee_inr) : 'the review fee'

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink to="/">All cases</BackLink>
      <h1 className="text-2xl font-semibold tracking-tight">Help</h1>
      <p className="text-muted mt-2 mb-6 text-sm">
        Short answers to common questions. Tap a question to open it.
      </p>

      <div className="space-y-3">
        <Question title="How do I file a new case?">
          <ol className="list-decimal space-y-2 pl-6">
            <li>
              On the <Link to="/" className="text-accent-ink font-semibold underline">Cases</Link>{' '}
              page, choose <strong>New case</strong>.
            </li>
            <li>Fill in the case details and add your documents (PDF, Word or photos).</li>
            <li>
              Choose <strong>Submit and pay</strong>. Your case goes to the advocate once the
              review fee is paid.
            </li>
          </ol>
          <p className="mt-3">
            You can stop at any time. Your case is saved as a draft that only you can see.
          </p>
        </Question>

        <Question title={`What is the ${fee} review fee for?`}>
          <p>
            It pays for the advocate to read your case and decide whether to take it on. The
            amount is always shown on the button before you pay.
          </p>
        </Question>

        <Question title="How does payment work?">
          <p>
            Payments are made through Razorpay, using UPI, card or net banking. After paying,
            the case page shows <strong>Confirming your payment</strong> for a few moments and
            then moves on by itself. You don't need to do anything else.
          </p>
          <p className="mt-3">
            If it takes longer than a few minutes, your money is safe. Use{' '}
            <strong>Check status</strong> on the case page, or contact us below.
          </p>
        </Question>

        <Question title="How do I get the draft?">
          <p>
            When the advocate sends the draft, the case page shows its price. Pay that price and
            the <strong>Download draft</strong> button appears. You can download it again at any time
            from the same case.
          </p>
          <p className="mt-3">
            If something needs changing, use <strong>Request changes</strong> and say what to
            fix. You can also write to the advocate in the case's chat.
          </p>
        </Question>

        <Question title="How do I make the text bigger?">
          <p>
            Go to{' '}
            <Link to="/profile#text-size" className="text-accent-ink font-semibold underline">
              Your profile
            </Link>{' '}
            and choose <strong>Large</strong> or <strong>Extra large</strong> under Text size.
            The whole site changes at once, and it is remembered on this device.
          </p>
          <p className="mt-3">
            You can also zoom with <kbd className="rounded border px-1.5">Ctrl</kbd> and{' '}
            <kbd className="rounded border px-1.5">+</kbd> (on a Mac,{' '}
            <kbd className="rounded border px-1.5">⌘</kbd> and{' '}
            <kbd className="rounded border px-1.5">+</kbd>).
          </p>
        </Question>

        <Question title="I forgot my password">
          <p>
            Sign out, then choose <strong>Forgot password?</strong> on the sign-in page. We'll
            email you a code to set a new one.
          </p>
        </Question>
      </div>

      <ContactCard />
    </div>
  )
}

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group surface rounded-[var(--radius-control)] border border-[var(--border)]">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 text-base font-semibold [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          className="size-6 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t border-[var(--border)] px-5 py-4 text-sm leading-relaxed">
        {children}
      </div>
    </details>
  )
}

export function ContactCard() {
  const { data: support, isLoading } = useQuery({
    queryKey: ['support'],
    queryFn: getSupport,
    staleTime: Infinity,
  })

  if (isLoading) return <Skeleton className="mt-6 h-32" />
  if (!support?.email && !support?.phone) return null

  return (
    <Card className="mt-6">
      <h2 className="text-base font-semibold">Still need help?</h2>
      {support.hours && <p className="text-muted mt-1 text-sm">{support.hours}</p>}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        {support.phone && (
          <a
            href={`tel:${support.phone.replace(/[^\d+]/g, '')}`}
            className="inline-flex min-h-12 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-strong)] px-4 text-sm font-semibold hover:bg-black/[0.04]"
          >
            <Phone className="size-5" aria-hidden />
            Call {support.phone}
          </a>
        )}
        {support.email && (
          <a
            href={`mailto:${support.email}`}
            className="inline-flex min-h-12 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-strong)] px-4 text-sm font-semibold break-all hover:bg-black/[0.04]"
          >
            <Mail className="size-5 shrink-0" aria-hidden />
            Email {support.email}
          </a>
        )}
      </div>
    </Card>
  )
}
