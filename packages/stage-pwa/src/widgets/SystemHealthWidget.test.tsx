import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// usePluginsStore transitively imports workspaceDb.ts, which constructs a real PouchDB at
// module load time - unavailable under happy-dom (see workspaceDb.test.ts's identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useClockSyncStore } = await import('../store/useClockSyncStore')
const { usePluginsStore } = await import('../store/usePluginsStore')
const { SystemHealthWidget } = await import('./SystemHealthWidget')

beforeEach(() => {
  usePluginsStore.setState({ installed: [], health: { plugins: {} } })
  useClockSyncStore.getState().reset()
})

describe('SystemHealthWidget - Uhrzeit-Sync', () => {
  it('shows "not yet synchronized" before the first successful sync', () => {
    render(<SystemHealthWidget />)
    expect(screen.getByText('Noch nicht synchronisiert')).toBeInTheDocument()
  })

  it('shows offset, drift, and time-since-sync after a successful sync', () => {
    useClockSyncStore.getState().setSync({ offsetMs: 12, rttMs: 8, jitterMs: 3, driftMs: 2 })
    render(<SystemHealthWidget />)
    expect(screen.getByText(/^Offset \+12 ms · Drift 2 ms · vor \d+s$/)).toBeInTheDocument()
  })

  it('renders a negative offset with a minus sign, not a double sign', () => {
    useClockSyncStore.getState().setSync({ offsetMs: -7, rttMs: 8, jitterMs: 1, driftMs: 1 })
    render(<SystemHealthWidget />)
    expect(screen.getByText(/^Offset -7 ms/)).toBeInTheDocument()
  })

  it('shows a "?" drift and a green dot right after the first-ever sync, with nothing yet to compare against', () => {
    useClockSyncStore.getState().setSync({ offsetMs: 5, rttMs: 10, jitterMs: 2, driftMs: null })
    render(<SystemHealthWidget />)
    expect(screen.getByText(/Drift \? ms/)).toBeInTheDocument()
    const dot = screen.getByText(/Drift \? ms/).firstChild as HTMLElement
    expect(dot).toHaveClass('bg-green-500')
  })

  it('flags a genuinely drifting offset (large cross-sync drift) amber, even with a noisy burst\'s raw jitter', () => {
    // A single noisy burst's own RTT spread (jitterMs) is no longer what drives the color -
    // see clockSync.ts's #31 follow-up doc comment: this specifically confirms that a huge
    // jitterMs alone does NOT flag amber unless driftMs also crosses the threshold.
    useClockSyncStore.getState().setSync({ offsetMs: 5, rttMs: 40, jitterMs: 400, driftMs: 45 })
    render(<SystemHealthWidget />)
    const dot = screen.getByText(/Drift 45 ms/).firstChild as HTMLElement
    expect(dot).toHaveClass('bg-amber-500')
  })

  it('flags a stable offset (small cross-sync drift) green, even with a noisy burst\'s raw jitter', () => {
    useClockSyncStore.getState().setSync({ offsetMs: 5, rttMs: 40, jitterMs: 373, driftMs: 3 })
    render(<SystemHealthWidget />)
    const dot = screen.getByText(/Drift 3 ms/).firstChild as HTMLElement
    expect(dot).toHaveClass('bg-green-500')
  })
})

describe('SystemHealthWidget - capabilities', () => {
  it('shows the empty-state message when no plugins are installed', () => {
    render(<SystemHealthWidget />)
    expect(screen.getByText('Keine Plugins installiert.')).toBeInTheDocument()
  })
})
