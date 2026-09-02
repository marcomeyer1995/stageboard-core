import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RowActionButton, RowActionsMenu, RowMenuButton } from './RowActionsMenu'

describe('RowMenuButton', () => {
  it('renders the "⋮" glyph with the given accessible label, and calls onClick', () => {
    const onClick = vi.fn()
    render(<RowMenuButton label="Weitere Optionen für Marco" onClick={onClick} />)

    const button = screen.getByRole('button', { name: 'Weitere Optionen für Marco' })
    expect(button).toHaveTextContent('⋮')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('RowActionsMenu', () => {
  it('renders the title, children, and a "Schließen" button', () => {
    render(
      <RowActionsMenu title="Marco" onClose={vi.fn()}>
        <RowActionButton>Umbenennen</RowActionButton>
      </RowActionsMenu>,
    )

    expect(screen.getByText('Marco')).toBeInTheDocument()
    expect(screen.getByText('Umbenennen')).toBeInTheDocument()
    expect(screen.getByText('Schließen')).toBeInTheDocument()
  })

  it('"Schließen" calls onClose', () => {
    const onClose = vi.fn()
    render(<RowActionsMenu title="Marco" onClose={onClose} />)

    fireEvent.click(screen.getByText('Schließen'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('clicking the backdrop calls onClose, but clicking the card itself does not', () => {
    const onClose = vi.fn()
    render(
      <RowActionsMenu title="Marco" onClose={onClose}>
        <RowActionButton>Umbenennen</RowActionButton>
      </RowActionsMenu>,
    )

    const card = screen.getByText('Marco').parentElement!
    const backdrop = card.parentElement!

    fireEvent.click(card)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('RowActionButton', () => {
  it('renders its children and forwards onClick', () => {
    const onClick = vi.fn()
    render(<RowActionButton onClick={onClick}>Löschen</RowActionButton>)

    fireEvent.click(screen.getByText('Löschen'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('forwards disabled and title', () => {
    render(
      <RowActionButton disabled title="Mindestens ein Admin muss bestehen bleiben.">
        Löschen
      </RowActionButton>,
    )

    const button = screen.getByText('Löschen') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('Mindestens ein Admin muss bestehen bleiben.')
  })

  it('applies a distinct style for danger actions', () => {
    render(<RowActionButton danger>Löschen</RowActionButton>)
    expect(screen.getByText('Löschen').className).toMatch(/text-red-400/)
  })
})
