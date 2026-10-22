import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Setlist } from 'shared-types'
import { ActiveSetlistWidget } from './ActiveSetlistWidget'
import { useShowMode } from '../lib/showMode'

vi.mock('../lib/showMode', () => {
  const useShowMode = vi.fn()
  // Widgets read the clock only where they show it (#457) - the same mocked show for every hook.
  const withClock = () => ({ ...useShowMode(), elapsedNow: () => useShowMode()?.elapsedMs ?? null })
  return { useShowMode, useShowModeCore: withClock, useShowModeOnDemand: () => useShowMode() }
})

function mockQueue(activeSetlist: Setlist | null) {
  vi.mocked(useShowMode).mockReturnValue({ queue: { activeSetlist } } as unknown as ReturnType<typeof useShowMode>)
}

describe('ActiveSetlistWidget', () => {
  it('shows the setlist the mode-aware queue resolved, with its song count', () => {
    mockQueue({
      id: 'practice',
      name: 'Übungs-Setlist',
      entries: [
        { id: 'e1', songId: 's1', variantId: null, trackId: null },
        { id: 'e2', songId: 's2', variantId: null, trackId: null },
      ],
    } as unknown as Setlist)
    render(<ActiveSetlistWidget config={{}} />)
    expect(screen.getByText('Übungs-Setlist')).toBeInTheDocument()
    expect(screen.getByText('2 Songs')).toBeInTheDocument()
  })

  it('shows "Keine" when the mode has no active setlist (e.g. Solo Üben full catalog)', () => {
    mockQueue(null)
    render(<ActiveSetlistWidget config={{}} />)
    expect(screen.getByText('Keine')).toBeInTheDocument()
  })
})
