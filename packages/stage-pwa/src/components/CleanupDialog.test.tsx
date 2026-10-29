import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CleanupDialog } from './CleanupDialog'

afterEach(() => localStorage.clear())

describe('CleanupDialog (Marco, 2026-10-29)', () => {
  it('shows each rule with its count, applies only the ticked ones and remembers them', () => {
    const onApply = vi.fn()
    render(<CleanupDialog text={'[am]a  \n\n\n\nb'} scope="der ganze Text" onApply={onApply} onCancel={vi.fn()} />)
    // Untick "Akkord-Grundton groß": the chord stays lower case.
    fireEvent.click(screen.getByRole('checkbox', { name: /Akkord-Grundton groß/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Aufräumen \(\d+ Stellen\)$/ }))
    expect(onApply).toHaveBeenCalledWith('[am]a\n\nb')
    expect(JSON.parse(localStorage.getItem('sb:text-cleanup-rules')!)).not.toContain('chordRootCaps')
  })

  it('nothing to change: the button says so and is off', () => {
    render(<CleanupDialog text={'[Am]a\nb'} scope="der ganze Text" onApply={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Nichts zu ändern' })).toBeDisabled()
  })
})
