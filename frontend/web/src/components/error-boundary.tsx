import { Component, type ErrorInfo, type ReactNode } from 'react'

import { ServerErrorPage } from '@/features/errors/server-error-page'

interface State {
  hasError: boolean
  resetKey?: string
}

// Catches render-time crashes anywhere below it so the user sees a recovery
// page instead of a blank screen. `resetKey` (e.g. the pathname) clears the
// error when the user navigates elsewhere.
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string; inline?: boolean },
  State
> {
  state: State = { hasError: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true }
  }

  static getDerivedStateFromProps(
    props: { resetKey?: string },
    state: State,
  ): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { hasError: false, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ServerErrorPage
          inline={this.props.inline}
          onRetry={() => this.setState({ hasError: false })}
        />
      )
    }
    return this.props.children
  }
}
