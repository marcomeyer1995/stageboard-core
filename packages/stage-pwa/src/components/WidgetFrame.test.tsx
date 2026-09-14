import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WidgetFrame } from './WidgetFrame'

describe('WidgetFrame', () => {
  it('renders its children at full opacity with no OFFLINE badge when available', () => {
    render(
      <WidgetFrame title="Tuner" status="available" isEditing={false} onRemove={vi.fn()}>
        <p>widget content</p>
      </WidgetFrame>,
    )

    expect(screen.getByText('widget content')).toBeInTheDocument()
    expect(screen.queryByTitle('Hardware nicht erreichbar')).not.toBeInTheDocument()

    const content = screen.getByText('widget content').parentElement
    expect(content).not.toHaveClass('opacity-50')
    expect(content).toHaveAttribute('aria-disabled', 'false')
  })

  it('lowers content opacity and shows the OFFLINE badge when degraded', () => {
    render(
      <WidgetFrame title="Tuner" status="degraded" isEditing={false} onRemove={vi.fn()}>
        <p>widget content</p>
      </WidgetFrame>,
    )

    const content = screen.getByText('widget content').parentElement
    expect(content).toHaveClass('opacity-50')
    expect(content).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTitle('Hardware nicht erreichbar')).toBeInTheDocument()
  })

  it('does not show the OFFLINE badge for a missing (not degraded) capability', () => {
    render(
      <WidgetFrame title="Tuner" status="missing" isEditing={false} onRemove={vi.fn()}>
        <p>widget content</p>
      </WidgetFrame>,
    )

    expect(screen.queryByTitle('Hardware nicht erreichbar')).not.toBeInTheDocument()
  })

  it('hides the border/background chrome when frameless and not editing', () => {
    render(
      <WidgetFrame title="Trenner" status="available" isEditing={false} onRemove={vi.fn()} frameless>
        <p>widget content</p>
      </WidgetFrame>,
    )
    const root = screen.getByText('widget content').parentElement!.parentElement!
    expect(root).not.toHaveClass('border')
    expect(root).not.toHaveClass('bg-surface')
  })

  it('keeps the chrome visible while editing even when frameless, so drag/resize bounds stay legible', () => {
    render(
      <WidgetFrame title="Trenner" status="available" isEditing={true} onRemove={vi.fn()} frameless>
        <p>widget content</p>
      </WidgetFrame>,
    )
    const root = screen.getByText('widget content').parentElement!.parentElement!
    expect(root).toHaveClass('border')
    expect(root).toHaveClass('bg-surface')
  })

  it('offers a frame toggle in the widget menu only when onToggleFrameless is provided', () => {
    const onToggleFrameless = vi.fn()
    render(
      <WidgetFrame
        title="Trenner"
        status="available"
        isEditing={true}
        onRemove={vi.fn()}
        frameless={false}
        onToggleFrameless={onToggleFrameless}
      >
        <p>widget content</p>
      </WidgetFrame>,
    )
    fireEvent.click(screen.getByTitle('Widget-Menü'))
    const toggle = screen.getByText('Rahmen ausblenden')
    fireEvent.click(toggle)
    expect(onToggleFrameless).toHaveBeenCalled()
  })
})
