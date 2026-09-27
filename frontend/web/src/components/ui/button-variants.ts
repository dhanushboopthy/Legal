import { cva } from 'class-variance-authority'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 text-center rounded-[var(--radius-control)] text-sm font-semibold transition-all duration-150 ease-out disabled:pointer-events-none disabled:opacity-60 active:scale-[0.98]',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] active:bg-[var(--color-accent-active)] shadow-sm',
        secondary: 'surface text-[var(--fg)] border border-[var(--border-strong)] hover:bg-black/[0.04]',
        ghost: 'text-[var(--fg)] hover:bg-black/[0.06]',
        danger: 'bg-[var(--color-danger)] text-white hover:opacity-90',
      },
      size: {
        // Large on every screen: older hands on a mouse miss small targets
        // as easily as fingers on a phone do.
        sm: 'min-h-11 px-4',
        md: 'min-h-12 px-5',
        lg: 'min-h-14 px-7 text-lg',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)
