import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/queue', () => ({ useQueue: () => ({ isMaster: true, activeSetlist: null }) }))
vi.mock('../lib/useMasterTakeover', () => ({
  useMasterTakeover: () => ({ status: 'live', canClaim: false, isForce: false, claim: vi.fn() }),
}))
vi.mock('../store/useDevicesStore', () => ({ useDeviceName: () => 'Fire' }))
vi.mock('../store/useShowStateStore', () => ({
  useShowStateStore: (select: (state: unknown) => unknown) =>
    select({ releaseMaster: vi.fn(), state: { playbackStatus: 'stopped', masterHolderId: 'this-device' } }),
}))

const { MasterControl } = await import('./MasterControl')
const { useSyncStore } = await import('../store/useSyncStore')

describe('MasterControl (#378: master display with a broken sync)', () => {
  beforeEach(() => {
    useSyncStore.setState({ streams: {}, browserOffline: false })
  })

  it('shows "Dieses Gerät" as usual while the sync works', () => {
    useSyncStore.setState({ streams: { band: 'paused' } })
    render(<MasterControl />)
    expect(screen.getByText('Dieses Gerät')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('marks its own master status as not synced when the sync failed for good', () => {
    useSyncStore.setState({ streams: { band: 'error' } })
    render(<MasterControl />)
    expect(screen.getByText('Dieses Gerät - nicht synchron')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Reparieren')
  })
})
