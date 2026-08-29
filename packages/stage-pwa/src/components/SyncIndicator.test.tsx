import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useSyncStore } from '../store/useSyncStore'
import { SyncIndicator } from './SyncIndicator'

beforeEach(() => {
  useSyncStore.setState({ streams: {}, progress: {} })
})

describe('SyncIndicator', () => {
  it('shows the "Synced" state when every stream is caught up (or none exist yet)', () => {
    render(<SyncIndicator />)
    expect(screen.getByText('Synchronisiert')).toBeInTheDocument()
  })

  it('shows a pulsing, animated icon while any stream is actively transferring', () => {
    useSyncStore.getState().setStreamStatus('songs', 'active')
    render(<SyncIndicator />)

    expect(screen.getByText('Synchronisiere…')).toBeInTheDocument()
    expect(screen.getByText('☁')).toHaveClass('animate-pulse')
  })

  it('shows Offline when a stream lost its connection, without animating', () => {
    useSyncStore.getState().setStreamStatus('songs', 'offline')
    render(<SyncIndicator />)

    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(screen.getByText('⃠')).not.toHaveClass('animate-pulse')
  })

  it('shows the worst status (error) even while another stream is still syncing', () => {
    useSyncStore.setState({ streams: { songs: 'active', setlists: 'error' } })
    render(<SyncIndicator />)
    expect(screen.getByText('Fehler')).toBeInTheDocument()
  })

  it('appends a percentage once a stream has reported pull progress', () => {
    useSyncStore.setState({
      streams: { songs: 'active' },
      progress: { songs: { pending: 25, initialPending: 100 } },
    })
    render(<SyncIndicator />)
    expect(screen.getByText('Synchronisiere… (75%)')).toBeInTheDocument()
  })

  it('shows the plain label when no stream has reported progress yet', () => {
    useSyncStore.setState({ streams: { songs: 'active' }, progress: {} })
    render(<SyncIndicator />)
    expect(screen.getByText('Synchronisiere…')).toBeInTheDocument()
  })

  it('does not show a percentage once caught up, even if a stale progress entry lingers', () => {
    useSyncStore.setState({
      streams: { songs: 'paused' },
      progress: { songs: { pending: 25, initialPending: 100 } },
    })
    render(<SyncIndicator />)
    expect(screen.getByText('Synchronisiert')).toBeInTheDocument()
  })
})
