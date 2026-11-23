import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ViewErrorBoundary } from './ViewErrorBoundary'

let broken = true
const Bad = () => {
  if (broken) throw new TypeError("Cannot read properties of undefined (reading 'length')")
  return <p>fine</p>
}

describe('ViewErrorBoundary (found on the Phone, 2026-11-22)', () => {
  it('a view that throws shows a message with the error and keeps the siblings on screen - not a blank app', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    broken = true
    render(
      <>
        <nav>menu</nav>
        <ViewErrorBoundary resetKey="system">
          <Bad />
        </ViewErrorBoundary>
      </>,
    )
    expect(screen.getByText('menu')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Diese Ansicht ist abgestürzt')
    expect(screen.getByRole('alert')).toHaveTextContent('reading \'length\'')
  })

  it('"Erneut versuchen" draws the view again, and another view (a new key) starts fresh', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    broken = true
    const { rerender } = render(
      <ViewErrorBoundary resetKey="system">
        <Bad />
      </ViewErrorBoundary>,
    )
    broken = false
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(screen.getByText('fine')).toBeInTheDocument()

    broken = true
    rerender(
      <ViewErrorBoundary resetKey="system">
        <Bad />
      </ViewErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    broken = false
    rerender(
      <ViewErrorBoundary resetKey="library">
        <Bad />
      </ViewErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeInTheDocument()
  })
})
