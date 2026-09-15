import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WidgetPreviewErrorBoundary } from './WidgetPreviewErrorBoundary'

function Throws(): never {
  throw new Error('boom')
}

describe('WidgetPreviewErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <WidgetPreviewErrorBoundary fallback={<p>fallback</p>}>
        <p>ok</p>
      </WidgetPreviewErrorBoundary>,
    )
    expect(screen.getByText('ok')).toBeInTheDocument()
    expect(screen.queryByText('fallback')).not.toBeInTheDocument()
  })

  it('renders the fallback instead of crashing when a child throws', () => {
    // React logs the caught error to the console by default - silence it for this test.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <WidgetPreviewErrorBoundary fallback={<p>fallback</p>}>
        <Throws />
      </WidgetPreviewErrorBoundary>,
    )
    expect(screen.getByText('fallback')).toBeInTheDocument()
    spy.mockRestore()
  })
})
