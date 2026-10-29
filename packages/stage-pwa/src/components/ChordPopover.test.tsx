import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChordPopover } from './ChordPopover'

describe('ChordPopover (#609)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('stays fully on a 360 px phone for a chord at the right edge', () => {
    vi.stubGlobal('innerWidth', 360)
    vi.stubGlobal('innerHeight', 780)
    const anchor = { left: 330, right: 350, top: 200, bottom: 220, width: 20, height: 20, x: 330, y: 200, toJSON: () => ({}) } as DOMRect
    render(<ChordPopover symbol="F#m7" anchor={anchor} onClose={vi.fn()} />)
    const popover = screen.getByRole('dialog', { name: 'Akkord F#m7' })
    const left = parseFloat(popover.style.left)
    const width = parseFloat(popover.style.width)
    expect(left).toBeGreaterThanOrEqual(12)
    expect(left + width).toBeLessThanOrEqual(360 - 12)
    expect(popover).toHaveTextContent('F# A C# E')
  })

  it('says so for a chord it cannot read, and offers no shape where the table has none', () => {
    const anchor = new DOMRect(10, 10, 20, 20)
    const { unmount } = render(<ChordPopover symbol="N.C." anchor={anchor} onClose={vi.fn()} />)
    expect(screen.getByText('Unbekannter Akkord')).toBeInTheDocument()
    unmount()
    render(<ChordPopover symbol="C9" anchor={anchor} onClose={vi.fn()} />)
    expect(screen.getByText('Kein Griffbild')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('C E G Bb D')
  })
})
