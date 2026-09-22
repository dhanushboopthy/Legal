// @types/jest-axe only augments Jest's `expect`; vitest has its own
// `Assertion` interface, so `toHaveNoViolations` needs its own declaration.
import 'vitest'

interface AxeMatchers<R = unknown> {
  toHaveNoViolations(): R
}

declare module 'vitest' {
  interface Assertion<T = unknown> extends AxeMatchers<T> {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
