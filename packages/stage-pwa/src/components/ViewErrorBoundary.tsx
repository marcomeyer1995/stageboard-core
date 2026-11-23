import { Component, type ReactNode } from 'react'
import { withTranslation, type WithTranslation } from 'react-i18next'
import { Button } from './ui'

interface Props extends WithTranslation {
  children: ReactNode
  /** Another value (the screen the person went to) starts the view fresh - an error does not follow them to the next screen. */
  resetKey: string
}

interface State {
  error: Error | null
  key: string
}

/**
 * Guards one screen of the app (Boards, Library, System). Without it a view that throws unmounts the whole React tree and the device shows a black screen
 * (found on the Phone, 2026-11-22: an old stage-map box without a name). Now only that view is replaced by a message with the error, the status bar and the
 * menu stay, and another screen or "Erneut versuchen" draws it again. React offers only class components for this.
 */
class Boundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  render() {
    const { t } = this.props
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="flex h-full flex-col items-start gap-3 p-6 text-ink">
        <h2 className="text-xl font-bold">{t('viewError.title')}</h2>
        <p className="text-base text-ink-muted">{t('viewError.hint')}</p>
        <p className="break-words text-sm text-ink-faint">{t('viewError.detail', { message: this.state.error.message })}</p>
        <Button variant="primary" onClick={() => this.setState({ error: null })}>
          {t('viewError.retry')}
        </Button>
      </div>
    )
  }
}

export const ViewErrorBoundary = withTranslation()(Boundary) as unknown as (props: { children: ReactNode; resetKey: string }) => ReactNode
