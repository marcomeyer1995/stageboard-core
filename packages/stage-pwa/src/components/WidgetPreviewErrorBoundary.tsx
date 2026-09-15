import { Component, type ReactNode } from 'react'

interface Props {
  fallback: ReactNode
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Guards one Widget Gallery tile's live mini-preview (WidgetLibrary.tsx) - React only
 * offers class components for this (no hook equivalent to componentDidCatch/
 * getDerivedStateFromError). A widget that throws with the gallery's default/empty config
 * falls back to plain title+description instead of taking the whole gallery down with it.
 */
export class WidgetPreviewErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}
