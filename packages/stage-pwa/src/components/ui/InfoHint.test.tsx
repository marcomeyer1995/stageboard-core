import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InfoHint } from './InfoHint'
import { Switch } from './Switch'

describe('InfoHint (docs/15 D12, #625)', () => {
  it('ⓘ opens the bubble; ⓘ again, a tap outside or Esc closes it', () => {
    render(
      <>
        <InfoHint text="Am sichersten zwei Ziele." label="Erklärung: Backup" />
        <button type="button">Daneben</button>
      </>,
    )
    const info = screen.getByRole('button', { name: 'Erklärung: Backup' })
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    fireEvent.click(info)
    expect(screen.getByRole('note')).toHaveTextContent('Am sichersten zwei Ziele.')
    expect(info).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(info)
    expect(screen.queryByRole('note')).not.toBeInTheDocument()

    fireEvent.click(info)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Daneben' }))
    expect(screen.queryByRole('note')).not.toBeInTheDocument()

    fireEvent.click(info)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('stays inside a phone-wide screen', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
    render(<InfoHint text="Lang genug, um umzubrechen." />)
    fireEvent.click(screen.getByRole('button', { name: 'Erklärung' }))
    const bubble = screen.getByRole('note')
    const left = parseFloat(bubble.style.left)
    const width = parseFloat(bubble.style.width)
    expect(left).toBeGreaterThanOrEqual(12)
    expect(left + width).toBeLessThanOrEqual(360 - 12)
  })

  it('a Switch puts its ⓘ beside the switch, not inside it - the switch still toggles', () => {
    let on = false
    render(<Switch label="Kompakt" description="Wirkt sofort." info="Knöpfe 48 px." checked={on} onChange={(next) => (on = next)} />)
    const toggle = screen.getByRole('switch', { name: /Kompakt/ })
    const info = screen.getByRole('button', { name: 'Erklärung: Kompakt' })
    expect(toggle).not.toContainElement(info)
    expect(toggle).toHaveTextContent('Wirkt sofort.')
    fireEvent.click(info)
    expect(screen.getByRole('note')).toHaveTextContent('Knöpfe 48 px.')
    expect(on).toBe(false)
    fireEvent.click(toggle)
    expect(on).toBe(true)
  })
})
