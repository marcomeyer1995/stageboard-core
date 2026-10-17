import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
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

    const content = screen.getByText('widget content').closest('[aria-disabled]')
    expect(content).not.toHaveClass('opacity-50')
    expect(content).toHaveAttribute('aria-disabled', 'false')
  })

  it('lowers content opacity and shows the OFFLINE badge when degraded', () => {
    render(
      <WidgetFrame title="Tuner" status="degraded" isEditing={false} onRemove={vi.fn()}>
        <p>widget content</p>
      </WidgetFrame>,
    )

    const content = screen.getByText('widget content').closest('[aria-disabled]')
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
    const root = screen.getByText('widget content').closest('[aria-disabled]')!.parentElement!
    expect(root).not.toHaveClass('border')
    expect(root).not.toHaveClass('bg-surface')
  })

  it('shows a frameless widget at its real size while editing - no frame, no padding, bounds as a dashed outline (Marco 2026-10-17)', () => {
    render(
      <WidgetFrame title="Trenner" status="available" isEditing={true} onRemove={vi.fn()} frameless>
        <p>widget content</p>
      </WidgetFrame>,
    )
    const content = screen.getByText('widget content').closest('[aria-disabled]')!
    const root = content.parentElement!
    expect(root).not.toHaveClass('border')
    expect(root).not.toHaveClass('bg-surface')
    expect(content).not.toHaveClass('p-4')
    expect(root).toHaveClass('outline-dashed')
  })

  it('the widget menu turns see-through while one of its sliders is dragged (Marco 2026-10-17)', () => {
    render(
      <WidgetFrame title="Prompter" status="available" isEditing onRemove={vi.fn()} configPanel={<input type="range" aria-label="Größe" />}>
        <p>widget content</p>
      </WidgetFrame>,
    )
    fireEvent.click(screen.getByTitle('Widget-Menü'))
    const dialog = screen.getByRole('dialog')
    fireEvent.pointerDown(screen.getByLabelText('Größe'))
    expect(dialog).toHaveClass('opacity-25')
    expect(dialog.parentElement).toHaveClass('bg-transparent')
    act(() => {
      document.dispatchEvent(new Event('pointerup'))
    })
    expect(dialog).not.toHaveClass('opacity-25')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Fertig' }))
    expect(dialog).not.toHaveClass('opacity-25')
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
    const toggle = screen.getByRole('switch', { name: 'Rahmen anzeigen' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(onToggleFrameless).toHaveBeenCalled()
  })

  it('"Kompakt" in the ⋯ menu switches the widget to 48 px controls - its own choice, visible (Marco 2026-10-17)', () => {
    const onToggleCompact = vi.fn()
    const { rerender } = render(
      <WidgetFrame title="Transport" status="available" isEditing onRemove={vi.fn()} onToggleCompact={onToggleCompact}>
        <p>widget content</p>
      </WidgetFrame>,
    )
    expect(screen.getByText('widget content').closest('.sb-compact')).toBeNull()
    fireEvent.click(screen.getByTitle('Widget-Menü'))
    const toggle = screen.getByRole('switch', { name: /Kompakt/ })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(onToggleCompact).toHaveBeenCalled()

    rerender(
      <WidgetFrame title="Transport" status="available" isEditing onRemove={vi.fn()} compact onToggleCompact={onToggleCompact}>
        <p>widget content</p>
      </WidgetFrame>,
    )
    expect(screen.getByText('widget content').closest('.sb-compact')).not.toBeNull()
  })

  it('"Anzeigen" lists the widget type\'s parts as chips - the same in every widget (Marco 2026-10-17)', () => {
    const onToggleHidden = vi.fn()
    render(
      <WidgetFrame
        title="Next Song"
        status="available"
        isEditing
        onRemove={vi.fn()}
        parts={[{ id: 'current', label: 'Aktuell' }, { id: 'next', label: 'Next' }]}
        hidden={['next']}
        onToggleHidden={onToggleHidden}
      >
        <p>widget content</p>
      </WidgetFrame>,
    )
    fireEvent.click(screen.getByTitle('Widget-Menü'))
    expect(screen.getByRole('group', { name: 'Anzeigen' })).toBeInTheDocument()
    expect(screen.getByText('Anzeigen')).toBeVisible()
    const next = screen.getByRole('button', { name: /Next/ })
    expect(next).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Aktuell/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(next)
    expect(onToggleHidden).toHaveBeenCalledWith('next')
  })

  it('outlines a too-small widget in edit mode only', () => {
    const { rerender, container } = render(
      <WidgetFrame title="Uhr" status="available" isEditing tooSmall onRemove={vi.fn()}>
        <p>widget content</p>
      </WidgetFrame>,
    )
    expect(container.firstElementChild).toHaveClass('outline-danger')
    expect(screen.getByText(/zu klein/)).toBeInTheDocument()

    rerender(
      <WidgetFrame title="Uhr" status="available" isEditing={false} tooSmall onRemove={vi.fn()}>
        <p>widget content</p>
      </WidgetFrame>,
    )
    expect(container.firstElementChild).not.toHaveClass('outline-danger')
    expect(screen.queryByText(/zu klein/)).not.toBeInTheDocument()
  })
})
