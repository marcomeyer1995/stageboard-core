import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { useClockSyncStore } = await import('../store/useClockSyncStore')
const { SyncCheckWidget } = await import('./SyncCheckWidget')

beforeEach(() => {
  useClockSyncStore.getState().reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SyncCheckWidget', () => {
  it('shows the server-synced clock, corrected by the current offset', () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-02T10:15:20.500Z').getTime())
    useClockSyncStore.getState().setSync({ offsetMs: 250, rttMs: 10, jitterMs: 2, driftMs: 3 })

    render(<SyncCheckWidget />)

    // Date.now() (10:15:20.500) + 250ms offset = 10:15:20.750
    expect(screen.getByText(/^\d{2}:\d{2}:20\.750$/)).toBeInTheDocument()
  })

  it('inverts the flash state on every synchronized-second boundary, not the wall-clock one', () => {
    useClockSyncStore.getState().setSync({ offsetMs: 0, rttMs: 10, jitterMs: 2, driftMs: 3 })

    // Two timestamps exactly one synced second apart must always land on opposite flash
    // states, regardless of which absolute second either one happens to be (the flash is
    // Math.floor(serverTime / 1000) % 2, not tied to any particular wall-clock parity).
    const t0 = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(t0)
    const { container: first, unmount } = render(<SyncCheckWidget />)
    const firstFlashOn = (first.firstChild as HTMLElement).classList.contains('bg-ink')
    unmount()

    vi.spyOn(Date, 'now').mockReturnValue(t0 + 1000)
    const { container: second } = render(<SyncCheckWidget />)
    const secondFlashOn = (second.firstChild as HTMLElement).classList.contains('bg-ink')

    expect(secondFlashOn).toBe(!firstFlashOn)
  })

  it('shows offset/drift once synced, and hides that line before the first sync', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now())

    const { rerender } = render(<SyncCheckWidget />)
    expect(screen.queryByText(/Offset/)).not.toBeInTheDocument()

    useClockSyncStore.getState().setSync({ offsetMs: -12, rttMs: 8, jitterMs: 400, driftMs: 4 })
    rerender(<SyncCheckWidget />)
    expect(screen.getByText('Offset -12 ms · Drift 4 ms')).toBeInTheDocument()
  })
})
