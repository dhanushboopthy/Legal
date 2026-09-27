import { isAxiosError } from 'axios'

const DEFAULT_FALLBACK = 'Something went wrong. Please try again.'

interface ValidationIssue {
  loc?: Array<string | number>
  msg?: string
}

// FastAPI's 422 body is `{detail: [{loc: ['body', 'title'], msg: '…'}]}`.
function describeIssue(issue: ValidationIssue): string | null {
  if (!issue.msg) return null
  // A model-level check (e.g. the password rules) reads as a plain sentence.
  if (issue.msg.startsWith('Value error, ')) return issue.msg.slice('Value error, '.length)
  const field = [...(issue.loc ?? [])]
    .reverse()
    .find((part) => typeof part === 'string' && part !== 'body' && part !== 'query')
  if (typeof field !== 'string') return issue.msg
  const name = field.replace(/_/g, ' ')
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}: ${issue.msg}`
}

/**
 * The message to show a person for a failed request: the server's own
 * explanation when it gave one (409 wrong status, 403 payment_required, a 422
 * naming the bad field), otherwise something honest about what went wrong.
 * Callers pass their own `fallback` when they can say more than the default.
 */
export function getErrorMessage(err: unknown, fallback: string = DEFAULT_FALLBACK): string {
  if (!isAxiosError(err)) return fallback

  if (!err.response) {
    return "Can't reach the server. Check your connection and try again."
  }

  const { status, data } = err.response
  const detail = data?.detail

  if (typeof detail === 'string' && detail.trim()) return detail

  if (Array.isArray(detail)) {
    const issues = detail
      .map((issue) => describeIssue(issue as ValidationIssue))
      .filter((line): line is string => line !== null)
      .slice(0, 3)
    if (issues.length > 0) return issues.join(' ')
  }

  if (status === 429) return 'Too many attempts. Please wait a moment and try again.'
  if (status >= 500) return 'The server had a problem. Please try again in a moment.'
  return fallback
}
