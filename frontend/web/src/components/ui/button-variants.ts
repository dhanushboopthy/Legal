import { cva } from 'class-variance-authority'

// Apple-style buttons: pill-shaped, medium weight, no borders or shadows.
// primary = the one filled accent action on a screen; secondary = a light
// grey fill; ghost = plain accent text (for "Start over", "Send a new code").
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 text-center rounded-full text-sm font-medium transition-colors duration-150 ease-[var(--ease-in)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] active:bg-[var(--color-accent-active)]',
        secondary: 'bg-black/[0.06] text-[var(--fg)] hover:bg-black/[0.1] active:bg-black/[0.14]',
        ghost: 'text-accent-ink hover:bg-[var(--color-accent)]/[0.08]',
        danger: 'bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger-ink)]',
      },
      size: {
        // Large on every screen: older hands on a mouse miss small targets
        // as easily as fingers on a phone do.
        sm: 'min-h-11 px-5',
        md: 'min-h-12 px-6',
        lg: 'min-h-14 px-8 text-lead',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)
