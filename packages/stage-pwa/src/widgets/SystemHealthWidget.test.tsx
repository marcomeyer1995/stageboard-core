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

  it('shows offset, jitter, and time-since-sync after a successful sync', () => {
    useClockSyncStore.getState().setSync({ offsetMs: 12, rttMs: 8, jitterMs: 3 })
    render(<SystemHealthWidget />)
    expect(screen.getByText(/^Offset \+12 ms · Jitter 3 ms · vor \d+s$/)).toBeInTheDocument()
  })

  it('renders a negative offset with a minus sign, not a double sign', () => {
    useClockSyncStore.getState().setSync({ offsetMs: -7, rttMs: 8, jitterMs: 1 })
    render(<SystemHealthWidget />)
    expect(screen.getByText(/^Offset -7 ms/)).toBeInTheDocument()
  })

  it('flags a noisy sync (large jitter) amber instead of green', () => {
    useClockSyncStore.getState().setSync({ offsetMs: 5, rttMs: 40, jitterMs: 45 })
    render(<SystemHealthWidget />)
    const dot = screen.getByText(/Jitter 45 ms/).firstChild as HTMLElement
    expect(dot).toHaveClass('bg-amber-500')
  })

  it('flags a clean sync (small jitter) green', () => {
    useClockSyncStore.getState().setSync({ offsetMs: 5, rttMs: 10, jitterMs: 2 })
    render(<SystemHealthWidget />)
    const dot = screen.getByText(/Jitter 2 ms/).firstChild as HTMLElement
    expect(dot).toHaveClass('bg-green-500')
  })
})

describe('SystemHealthWidget - capabilities', () => {
  it('shows the empty-state message when no plugins are installed', () => {
    render(<SystemHealthWidget />)
    expect(screen.getByText('Keine Plugins installiert.')).toBeInTheDocument()
  })
})
