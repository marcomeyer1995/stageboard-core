import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const queue = { isMaster: true, activeSetlist: null }
const claim = vi.fn()
const releaseMaster = vi.fn()
const takeover = { canClaim: true }
const show = { holdsToken: true, selfCheck: 'ok' as string, holder: 'this-device' }

vi.mock('../lib/queue', () => ({ useQueue: () => queue }))
vi.mock('../lib/useMasterTakeover', () => ({
  useMasterTakeover: () => ({ status: 'self', canClaim: takeover.canClaim, isForce: false, claim }),
}))
vi.mock('../store/useDevicesStore', () => ({ useDeviceName: () => 'Fire' }))
vi.mock('../store/useShowStateStore', () => ({
  useShowStateStore: (select: (state: unknown) => unknown) =>
    select({
      releaseMaster,
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

  it("'account' master mode (#85): says it's you with all your devices", () => {
    show.holder = 'profile:p1'
    render(<MasterControl />)
    expect(screen.getByText('Du bist Master – alle deine Geräte.')).toBeInTheDocument()
  })

  it('one "Master" row, yellow (pressed) while this device controls the show', () => {
    render(<MasterControl />)
    expect(screen.getByRole('button', { name: 'Master' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Du bist Master – nur dieses Gerät.')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says who else is master, or nobody', () => {
    queue.isMaster = false
    show.holdsToken = false
    show.holder = 'other-device'
    const { unmount } = render(<MasterControl />)
    expect(screen.getByRole('button', { name: 'Master' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Fire ist Master.')).toBeInTheDocument()
    unmount()
    show.holder = ''
    render(<MasterControl />)
    expect(screen.getByText('Niemand ist Master.')).toBeInTheDocument()
  })

  describe('held to change, both ways (Marco, #409)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      claim.mockReset()
      releaseMaster.mockReset()
    })
    afterEach(() => vi.useRealTimers())

    it('holding takes it over', () => {
      queue.isMaster = false
      show.holdsToken = false
      show.holder = ''
      render(<MasterControl />)
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Master' }))
      act(() => vi.advanceTimersByTime(650))
      expect(claim).toHaveBeenCalledTimes(1)
    })

    it('after the hold the row stays in the new state while the change goes through - no jump back', () => {
      queue.isMaster = false
      show.holdsToken = false
      show.holder = ''
      render(<MasterControl />)
      const button = screen.getByRole('button', { name: 'Master' })
      fireEvent.pointerDown(button)
      act(() => vi.advanceTimersByTime(650))
      // The token hasn't changed yet (the mock never does), the row already shows it.
      expect(button).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('master-progress').style.width).toBe('100%')
      // If the change never happens, it falls back after a few seconds.
      act(() => vi.advanceTimersByTime(4100))
      expect(button).toHaveAttribute('aria-pressed', 'false')
    })

    it('holding hands it over', async () => {
      render(<MasterControl />)
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Master' }))
      await act(async () => vi.advanceTimersByTime(650))
      expect(releaseMaster).toHaveBeenCalledTimes(1)
    })

    it('a short tap changes nothing and says to hold it', () => {
      render(<MasterControl />)
      const button = screen.getByRole('button', { name: 'Master' })
      fireEvent.pointerDown(button)
      act(() => vi.advanceTimersByTime(200))
      fireEvent.pointerUp(button)
      act(() => vi.advanceTimersByTime(1000))
      expect(releaseMaster).not.toHaveBeenCalled()
      expect(screen.getByRole('status')).toHaveTextContent('Zum Abgeben gedrückt halten')
    })

    it('without the right to take over, the row is disabled and says why', () => {
      queue.isMaster = false
      show.holdsToken = false
      show.holder = 'other-device'
      takeover.canClaim = false
      render(<MasterControl />)
      expect(screen.getByRole('button', { name: 'Master' })).toBeDisabled()
      expect(screen.getByText(/nur Admin\/Showmaster/)).toBeInTheDocument()
      takeover.canClaim = true
    })
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
    expect(screen.getByRole('button', { name: 'Master' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Master' })).toBeEnabled()
  })
})
