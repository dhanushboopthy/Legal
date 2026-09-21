import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Field, Input } from '@/components/ui/input'

afterEach(cleanup)

describe('Field', () => {
  it('links the label and marks nothing invalid while there is no error', () => {
    render(
      <Field id="email" label="Email">
        {(c) => <Input {...c} />}
      </Field>,
    )
    const input = screen.getByLabelText('Email')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('flags the control invalid and points it at an announced error', () => {
    render(
      <Field id="email" label="Email" error="Enter a valid email address">
        {(c) => <Input {...c} />}
      </Field>,
    )
    const input = screen.getByLabelText('Email')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Enter a valid email address')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toBe(alert.id)
  })

  it('describes the control by both the hint and the error', () => {
    render(
      <Field id="pw" label="Password" hint="At least 8 characters" error="Too short">
        {(c) => <Input {...c} />}
      </Field>,
    )
    const ids = screen.getByLabelText('Password').getAttribute('aria-describedby')?.split(' ')
    expect(ids).toEqual(['pw-hint', 'pw-error'])
  })
})
