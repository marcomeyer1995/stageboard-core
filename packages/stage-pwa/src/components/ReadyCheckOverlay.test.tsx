import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadyCheckOverlay } from './ReadyCheckOverlay'
import { reportReady } from '../lib/reportReady'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useReadyCheckStore } from '../store/useReadyCheckStore'

// The stores underneath transitively build a real PouchDB at import time (unavailable under
// happy-dom), so the state this overlay reads is mocked directly - same reasoning as the widget tests.
const state = {
  mode: 'gig',
  readyCheckId: 'c1' as string | null,
  isMaster: false,
  readyProfileIds: [] as string[],
}
vi.mock('../store/useAppModeStore', () => ({
  useAppModeStore: (selector: (s: { mode: string }) => unknown) => selector({ mode: state.mode }),
}))
vi.mock('../store/useShowStateStore', () => ({
  useShowStateStore: (selector: (s: unknown) => unknown) =>
    selector({ state: { readyCheckId: state.readyCheckId }, isMaster: state.isMaster }),
}))
vi.mock('../store/usePresenceStore', () => ({
  usePresenceStore: (selector: (s: unknown) => unknown) =>
    selector({ presence: { devices: {}, readyCheck: state.readyCheckId ? { checkId: state.readyCheckId, readyProfileIds: state.readyProfileIds } : undefined } }),
}))
vi.mock('../store/useWorkspaceStore', () => ({
  useWorkspaceStore: (selector: (s: { activeWorkspaceId: string }) => unknown) => selector({ activeWorkspaceId: 'band' }),
}))
vi.mock('../lib/useActiveProfile', () => ({ useActiveProfile: vi.fn() }))
vi.mock('../lib/reportReady', () => ({ reportReady: vi.fn() }))

describe('ReadyCheckOverlay (#60)', () => {
  beforeEach(() => {
    Object.assign(state, { mode: 'gig', readyCheckId: 'c1', isMaster: false, readyProfileIds: [] })
    useReadyCheckStore.setState({ handledCheckId: null })
    vi.mocked(useActiveProfile).mockReturnValue({ id: 'anna', name: 'Anna', stageRoles: [] })
    vi.mocked(reportReady).mockReset().mockResolvedValue(true)
  })

  it('shows the big button while a check is open', () => {
    render(<ReadyCheckOverlay />)
    expect(screen.getByRole('dialog', { name: 'Ready-Check' })).toBeInTheDocument()
    expect(screen.getByText('Ich bin bereit')).toBeInTheDocument()
  })

  it('stays away when no check is open, in Solo Üben, or on the Master', () => {
    state.readyCheckId = null
    const { rerender } = render(<ReadyCheckOverlay />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    Object.assign(state, { readyCheckId: 'c1', mode: 'practice' })
    rerender(<ReadyCheckOverlay />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    Object.assign(state, { mode: 'gig', isMaster: true })
    rerender(<ReadyCheckOverlay />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reports this profile and dismisses once the Stage-Server took the answer', async () => {
    render(<ReadyCheckOverlay />)
    fireEvent.click(screen.getByText('Ich bin bereit'))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(reportReady).toHaveBeenCalledWith('band', 'c1', 'anna')
  })

  it('stays up with a retry hint when the answer could not be delivered', async () => {
    vi.mocked(reportReady).mockResolvedValue(false)
    render(<ReadyCheckOverlay />)
    fireEvent.click(screen.getByText('Ich bin bereit'))

    expect(await screen.findByText(/Keine Verbindung zum Stage-Server/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('disappears when this profile is already ready (e.g. answered from another tablet)', () => {
    state.readyProfileIds = ['anna']
    render(<ReadyCheckOverlay />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers only "Schließen" on a device without a profile', () => {
    vi.mocked(useActiveProfile).mockReturnValue(undefined)
    render(<ReadyCheckOverlay />)
    fireEvent.click(screen.getByText('Schließen'))
    expect(reportReady).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
