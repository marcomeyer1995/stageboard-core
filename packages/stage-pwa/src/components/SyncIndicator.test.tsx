import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

// useWorkspaceStore transitively imports workspaceDb.ts, which constructs a real PouchDB at
// module load time - unavailable under happy-dom (see BandManagementView.test.tsx's identical
// mock, and workspaceDb.test.ts's own).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useSyncStore } = await import('../store/useSyncStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useDialogStore } = await import('../store/useDialogStore')
const { SyncIndicator } = await import('./SyncIndicator')

beforeEach(() => {
  useSyncStore.setState({ streams: {}, progress: {} })
  useWorkspaceStore.setState({
    workspaces: [{ id: 'band-a', name: 'Band A', ownProfileId: 'p1', username: 'stageboard-band-a-p1~device-1', couchPassword: 'pw' }],
    activeWorkspaceId: 'band-a',
  })
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

  describe('Reparieren (found live, 2026-09-09: a 401 kills PouchDB sync permanently, no auto-recovery)', () => {
    it('only shows the repair button once sync has actually errored', () => {
      useSyncStore.setState({ streams: { songs: 'active' } })
      render(<SyncIndicator />)
      expect(screen.queryByRole('button', { name: 'Reparieren' })).not.toBeInTheDocument()
    })

    it('shows the repair button once sync has errored', () => {
      useSyncStore.setState({ streams: { songs: 'error' } })
      render(<SyncIndicator />)
      expect(screen.getByRole('button', { name: 'Reparieren' })).toBeInTheDocument()
    })

    it('prompts for the access code and re-joins as this device\'s own already-known profile', async () => {
      const promptText = vi.fn().mockResolvedValue('12345678')
      const joinAsMember = vi.fn().mockResolvedValue({ id: 'band-a' })
      useDialogStore.setState({ promptText })
      useWorkspaceStore.setState({ joinAsMember })
      useSyncStore.setState({ streams: { songs: 'error' } })
      render(<SyncIndicator />)

      fireEvent.click(screen.getByRole('button', { name: 'Reparieren' }))
      await vi.waitFor(() => expect(joinAsMember).toHaveBeenCalled())

      expect(promptText).toHaveBeenCalledWith('Sync reparieren', { label: 'Zugangscode für „Band A"' })
      expect(joinAsMember).toHaveBeenCalledWith('band-a', 'Band A', '12345678', 'p1')
    })

    it('does nothing if the access code prompt is cancelled', async () => {
      const promptText = vi.fn().mockResolvedValue(null)
      const joinAsMember = vi.fn()
      useDialogStore.setState({ promptText })
      useWorkspaceStore.setState({ joinAsMember })
      useSyncStore.setState({ streams: { songs: 'error' } })
      render(<SyncIndicator />)

      fireEvent.click(screen.getByRole('button', { name: 'Reparieren' }))
      await vi.waitFor(() => expect(promptText).toHaveBeenCalled())

      expect(joinAsMember).not.toHaveBeenCalled()
    })

    it('warns instead of prompting when this device has no known profile for the active workspace', async () => {
      const promptText = vi.fn()
      const alert = vi.fn().mockResolvedValue(undefined)
      useDialogStore.setState({ promptText, alert })
      useWorkspaceStore.setState({
        workspaces: [{ id: 'band-a', name: 'Band A', username: 'stageboard-band-a-p1~device-1', couchPassword: 'pw' }],
      })
      useSyncStore.setState({ streams: { songs: 'error' } })
      render(<SyncIndicator />)

      fireEvent.click(screen.getByRole('button', { name: 'Reparieren' }))
      await vi.waitFor(() => expect(alert).toHaveBeenCalled())

      expect(promptText).not.toHaveBeenCalled()
    })
  })
})
