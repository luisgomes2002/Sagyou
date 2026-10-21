import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  area: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Keeps one broken workspace view from taking down navigation and the rest of the app. */
export class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[view] ${this.props.area} failed to render`, error, info)
  }

  private retry = (): void => this.setState({ error: null })

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <section
        role="alert"
        className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#0b0b0f] p-8 text-center"
      >
        <div>
          <h1 className="text-base font-semibold text-[#d4d4d4]">
            Não foi possível abrir esta área
          </h1>
          <p className="mt-1 text-sm text-[#999999]">
            A falha ficou isolada em {this.props.area}. Seus dados não foram alterados.
          </p>
        </div>
        <button
          type="button"
          onClick={this.retry}
          className="rounded-lg bg-[#7c3aed] px-4 py-2 text-sm font-medium text-white hover:bg-[#6d28d9]"
        >
          Tentar novamente
        </button>
      </section>
    )
  }
}
