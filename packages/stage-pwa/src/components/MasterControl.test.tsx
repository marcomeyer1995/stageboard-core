import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queue = { isMaster: true, activeSetlist: null }
const show = { holdsToken: true, selfCheck: 'ok' as string, holder: 'this-device' }

vi.mock('../lib/queue', () => ({ useQueue: () => queue }))
vi.mock('../lib/useMasterTakeover', () => ({
  useMasterTakeover: () => ({ status: 'self', canClaim: false, isForce: false, claim: vi.fn() }),
}))
vi.mock('../store/useDevicesStore', () => ({ useDeviceName: () => 'Fire' }))
vi.mock('../store/useShowStateStore', () => ({
  useShowStateStore: (select: (state: unknown) => unknown) =>
    select({
      releaseMaster: vi.fn(),
      holdsToken: show.holdsToken,
      selfCheck: show.selfCheck,
      state: { playbackStatus: 'stopped', masterHolderId: show.holder },
    }),
}))

vi.mock('../store/useProfilesStore', () => ({
  useProfilesStore: (select: (state: unknown) => unknown) => select({ profiles: [{ id: 'p1', name: 'Marco' }] }),
}))

const { MasterControl } = await import('./MasterControl')

describe('MasterControl (#378: master self-check)', () => {
  beforeEach(() => {
    queue.isMaster = true
    show.holdsToken = true
    show.selfCheck = 'ok'
    show.holder = 'this-device'
  })

  it("'account' master mode (#85): the holder is the person with all their devices", () => {
    show.holder = 'profile:p1'
    render(<MasterControl />)
    expect(screen.getByText('Du (alle deine Geräte)')).toBeInTheDocument()
  })

  it('shows "Dieses Gerät" while the self-check passes', () => {
    render(<MasterControl />)
    expect(screen.getByText('Dieses Gerät')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it.each([
    ['sync-error', 'nicht synchron', 'Reparieren'],
    ['offline', 'offline', 'Verbindung'],
    ['unconfirmed', 'nicht bestätigt', 'anderes Gerät übernommen'],
  ])('holder failing the self-check (%s): marked, explained, still able to hand the token back', (check, label, hint) => {
    queue.isMaster = false
    show.selfCheck = check
    render(<MasterControl />)
    expect(screen.getByText(`Dieses Gerät - ${label}`)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(hint)
    expect(screen.getByRole('button', { name: 'Master abgeben' })).toBeInTheDocument()
  })
})
