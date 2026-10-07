import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActionMenu, ActiveMarker, Badge, Button, ChipGroup, Dialog, Field, IconButton, ListRow, Segmented, Select, Slider, StatusDot, Switch, Tabs, ToggleChip } from '.'

describe('UI system (docs/15)', () => {
  it('Button: one corner token, the size sets the height (D2), primary is yellow, secondary the lighter grey (D3)', () => {
    render(
      <>
        <Button variant="primary" size="show">Play</Button>
        <Button size="stage">Weiter</Button>
        <Button variant="danger">Löschen</Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Play' })).toHaveClass('min-h-show', 'rounded-control', 'bg-accent')
    expect(screen.getByRole('button', { name: 'Weiter' })).toHaveClass('min-h-stage', 'bg-control-strong')
    expect(screen.getByRole('button', { name: 'Löschen' })).toHaveClass('min-h-form', 'text-red-400')
  })

  it('IconButton: named, never below the form height', () => {
    render(<IconButton icon="close" label="Schließen" />)
    expect(screen.getByRole('button', { name: 'Schließen' })).toHaveClass('h-form', 'w-form')
  })

  it('Segmented (pick one, D7): a radio group; tapping the chosen one again changes nothing', () => {
    const onChange = vi.fn()
    render(<Segmented label="Modus" value="gig" onChange={onChange} options={[{ value: 'gig', label: 'Gig' }, { value: 'practice', label: 'Solo Üben' }]} />)
    expect(screen.getByRole('radiogroup', { name: 'Modus' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Gig' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'Gig' }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'Solo Üben' }))
    expect(onChange).toHaveBeenCalledWith('practice')
  })

  it('ToggleChip (pick several, D7): ✓ when chosen, tapping again removes it; the group says "Mehrere möglich"', () => {
    const onToggle = vi.fn()
    const { container } = render(
      <ChipGroup label="Empfänger">
        <ToggleChip label="Caro" selected onToggle={onToggle} />
        <ToggleChip label="Kapper" selected={false} onToggle={onToggle} />
      </ChipGroup>,
    )
    expect(screen.getByRole('button', { name: 'Caro' })).toHaveAttribute('aria-pressed', 'true')
    // A checkbox in front of every chip (so the width never changes): ticked when chosen, empty when not.
    expect(container.querySelectorAll('button')[0]!.querySelector('[data-checkbox]')).toHaveAttribute('data-checkbox', 'checked')
    expect(container.querySelectorAll('button')[0]!.querySelector('svg')).not.toBeNull()
    expect(container.querySelectorAll('button')[1]!.querySelector('[data-checkbox]')).toHaveAttribute('data-checkbox', 'empty')
    expect(container.querySelectorAll('button')[1]!.querySelector('svg')).toBeNull()
    expect(screen.getByRole('button', { name: 'Kapper' })).toHaveClass('font-semibold')
    fireEvent.click(screen.getByRole('button', { name: 'Caro' }))
    expect(onToggle).toHaveBeenCalledWith(false)
    expect(screen.getByText('Mehrere möglich')).toBeInTheDocument()
  })

  it('Switch (on/off, D5): role switch, the whole row toggles', () => {
    const onChange = vi.fn()
    render(<Switch label="Einrasten" description="Taktstriche rasten auf Drum-Hits" checked={false} onChange={onChange} />)
    const sw = screen.getByRole('switch', { name: /Einrasten/ })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('Tabs: page navigation with aria-selected and an underline, not a fill', () => {
    const onChange = vi.fn()
    render(<Tabs label="System" value="band" onChange={onChange} tabs={[{ value: 'band', label: 'Band' }, { value: 'plugins', label: 'Plugins' }]} />)
    expect(screen.getByRole('tab', { name: 'Band' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Band' })).toHaveClass('border-accent')
    expect(screen.getByRole('tab', { name: 'Band' })).not.toHaveClass('bg-accent')
    fireEvent.click(screen.getByRole('tab', { name: 'Plugins' }))
    expect(onChange).toHaveBeenCalledWith('plugins')
  })

  it('Field / Select / Slider: label tied to the control, one height, error replaces the hint', () => {
    const onSlide = vi.fn()
    render(
      <>
        <Field label="Name" hint="So heißt es im Menü" />
        <Field label="BPM" error="Zahl eingeben" />
        <Select label="Tonart" options={[{ value: 'A', label: 'A' }]} />
        <Slider label="Anzeigedauer" valueLabel="8 s" value={8} min={3} max={20} onChange={onSlide} />
      </>,
    )
    expect(screen.getByLabelText('Name')).toHaveClass('min-h-form', 'rounded-control')
    expect(screen.getByText('So heißt es im Menü')).toBeInTheDocument()
    expect(screen.getByLabelText('BPM')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Tonart').tagName).toBe('SELECT')
    fireEvent.change(screen.getByLabelText(/Anzeigedauer/), { target: { value: '12' } })
    expect(onSlide).toHaveBeenCalledWith(12)
  })

  it('Dialog (D6) without anything to confirm: one "Fertig" at the bottom, nothing in the title row', () => {
    const onClose = vi.fn()
    render(
      <Dialog title="Tonart" onClose={onClose}>
        <p>Transpose</p>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Tonart' })
    expect(dialog).toHaveClass('rounded-container')
    expect(screen.queryByRole('button', { name: /Schließen/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(dialog.parentElement!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('Dialog (D6) with something to confirm: only the bottom row - one way out', () => {
    const onClose = vi.fn()
    render(
      <Dialog title="Neue Setlist" onClose={onClose} actions={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary">Anlegen</Button></>}>
        <Field label="Name" />
      </Dialog>,
    )
    expect(screen.queryByRole('button', { name: /Schließen|Fertig/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ActionMenu: opens from a wide ⋯, runs an action and closes; red actions apart, disabled stays disabled', () => {
    const rename = vi.fn()
    render(<ActionMenu title="Bühne" actions={[{ label: 'Umbenennen', onClick: rename }, { label: 'Löschen', onClick: vi.fn(), danger: true, disabled: true }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menü: Bühne' }))
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Umbenennen' }))
    expect(rename).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ListRow / ActiveMarker (D4) / Badge / StatusDot', () => {
    const onClick = vi.fn()
    render(
      <>
        <ActiveMarker active badge="Du">
          <ListRow title="Marco" subtitle="Admin" onClick={onClick} />
        </ActiveMarker>
        <ListRow title="Prompter" selected onClick={vi.fn()} />
        <Badge tone="warning">zu klein</Badge>
        <StatusDot status="error" />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Marco/ }))
    expect(onClick).toHaveBeenCalled()
    expect(screen.getByText('Du')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Prompter/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('zu klein')).toHaveClass('rounded-sb-pill')
    expect(screen.getByRole('img', { name: 'Fehler' })).toBeInTheDocument()
  })
})
