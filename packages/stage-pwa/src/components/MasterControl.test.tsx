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
    expect(screen.getByText(/Du steuerst die Show \(alle deine Geräte\)/)).toBeInTheDocument()
  })

  it('like Modus: "Ich" is yellow (pressed) while this device controls the show, "Andere" hands it over', () => {
    render(<MasterControl />)
    expect(screen.getByRole('button', { name: 'Ich' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Andere' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(/Dieses Gerät steuert die Show/)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('the labels stay the same when someone else holds it - only the yellow moves', () => {
    queue.isMaster = false
    show.holdsToken = false
    show.holder = 'other-device'
    render(<MasterControl />)
    expect(screen.getByRole('button', { name: 'Ich' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Andere' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/steuert die Show/)).toBeInTheDocument()
  })

  it.each([
    ['sync-error', 'nicht synchron', 'Reparieren'],
    ['offline', 'offline', 'Verbindung'],
    ['unconfirmed', 'nicht bestätigt', 'anderes Gerät übernommen'],
  ])('holder failing the self-check (%s): explained, still able to hand the token back', (check, _label, hint) => {
    queue.isMaster = false
    show.selfCheck = check
    render(<MasterControl />)
    expect(screen.getByRole('status')).toHaveTextContent(hint)
    expect(screen.getByRole('button', { name: 'Ich' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Andere' })).toBeEnabled()
  })
})
