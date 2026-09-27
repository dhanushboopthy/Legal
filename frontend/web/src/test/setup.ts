import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { toHaveNoViolations } from 'jest-axe'
import { expect } from 'vitest'

expect.extend(toHaveNoViolations)

// findBy*/waitFor give up after 1 s by default. Test files run in parallel and
// the axe checks are CPU-heavy, so a page that loads in 200 ms alone can take
// over a second in the full run; 5 s removes that flake without hiding a
// real hang.
configure({ asyncUtilTimeout: 5_000 })
