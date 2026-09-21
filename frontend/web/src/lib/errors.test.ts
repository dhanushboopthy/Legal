import { AxiosError, type AxiosResponse } from 'axios'
import { describe, expect, it } from 'vitest'

import { getErrorMessage } from '@/lib/errors'

function axiosFailure(status: number, data: unknown): AxiosError {
  const response = { status, data, statusText: '', headers: {}, config: {} } as AxiosResponse
  return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, response)
}

describe('getErrorMessage', () => {
  it("shows the server's own explanation when it sent a string detail", () => {
    const err = axiosFailure(409, {
      detail: "Cannot perform 'approve' while case status is 'accepted'",
    })
    expect(getErrorMessage(err)).toBe("Cannot perform 'approve' while case status is 'accepted'")
  })

  it('turns a FastAPI 422 array into readable field messages', () => {
    const err = axiosFailure(422, {
      detail: [
        { loc: ['body', 'title'], msg: 'String should have at least 3 characters', type: 'x' },
        { loc: ['body', 'case_type'], msg: 'Field required', type: 'x' },
      ],
    })
    expect(getErrorMessage(err)).toBe(
      'Title: String should have at least 3 characters Case type: Field required',
    )
  })

  it('says so when the server cannot be reached at all', () => {
    const err = new AxiosError('Network Error', 'ERR_NETWORK')
    expect(getErrorMessage(err)).toMatch(/can't reach the server/i)
  })

  it('has a specific line for rate limiting and server faults', () => {
    expect(getErrorMessage(axiosFailure(429, { error: 'Rate limit exceeded' }))).toMatch(
      /too many/i,
    )
    expect(getErrorMessage(axiosFailure(500, { detail: 'An unexpected error occurred' }))).toBe(
      'An unexpected error occurred',
    )
    expect(getErrorMessage(axiosFailure(502, '<html>bad gateway</html>'))).toMatch(
      /server had a problem/i,
    )
  })

  it('uses the caller fallback for anything it cannot explain', () => {
    expect(getErrorMessage(new Error('boom'), 'Could not save decision')).toBe(
      'Could not save decision',
    )
    expect(getErrorMessage(axiosFailure(400, {}), 'Could not save decision')).toBe(
      'Could not save decision',
    )
  })
})
