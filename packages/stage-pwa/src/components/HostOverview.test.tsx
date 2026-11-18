import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostOverview as Overview } from '../lib/hostOverview'
import '../i18n'

const overview = vi.hoisted(() => ({ value: null as Overview | null }))
const session = vi.hoisted(() => ({ isAdmin: true, playing: false }))
const action = vi.hoisted(() => ({ run: vi.fn(async () => 'done' as string) }))
const dialogs = vi.hoisted(() => ({ confirm: vi.fn(async () => true), alert: vi.fn(async () => {}) }))
vi.mock('../lib/hostActions', () => ({ hostAction: action.run }))
vi.mock('../store/useWorkspaceStore', () => ({
  useWorkspaceStore: (select: (s: unknown) => unknown) =>
    select({ activeWorkspaceId: 'w', workspaces: [{ id: 'w', isAdmin: session.isAdmin, username: 'stageboard-w-a~d', couchPassword: 'secret' }] }),
}))
vi.mock('../store/useShowStateStore', () => ({ useShowStateStore: (select: (s: unknown) => unknown) => select({ state: { playbackStatus: session.playing ? 'playing' : 'stopped' } }) }))
vi.mock('../store/useDialogStore', () => ({ useDialogStore: (select: (s: unknown) => unknown) => select(dialogs) }))
vi.mock('../lib/useHostOverview', () => ({ useHostOverview: () => overview.value }))

const { HostOverview } = await import('./HostOverview')

const row = (over: object = {}) => ({ hostId: 'laptop', role: 'primary' as const, url: 'https://10.0.0.1:8443', state: 'host' as const, status: 'ok' as const, epoch: 1, current: false, ...over })

beforeEach(() => {
  overview.value = null
  session.isAdmin = true
  session.playing = false
  action.run.mockClear()
  action.run.mockResolvedValue('done')
  dialogs.confirm.mockClear()
  dialogs.confirm.mockResolvedValue(true)
  dialogs.alert.mockClear()
})

describe('HostOverview (#941)', () => {
  it('shows nothing while there is nothing to show (no two hosts, or no answer yet)', () => {
    const { container } = render(<HostOverview />)
    expect(container.textContent).toBe('')
    overview.value = { rows: [], problem: null }
    const again = render(<HostOverview />)
    expect(again.container.textContent).toBe('')
  })

  it('names each host with its role and what it is doing, and marks the one this device is on', () => {
    overview.value = {
      rows: [row({ current: true }), row({ hostId: 'stage-pc', role: 'backup', state: 'standby', status: 'off', epoch: 1, url: 'https://10.0.0.2:8443' })],
      problem: null,
    }
    render(<HostOverview />)
    expect(screen.getByText('laptop')).toBeTruthy()
    expect(screen.getByText('stage-pc')).toBeTruthy()
    expect(screen.getByText(/Primary/)).toBeTruthy()
    expect(screen.getByText(/Backup/)).toBeTruthy()
    expect(screen.getByText(/ist der Host/)).toBeTruthy()
    expect(screen.getByText(/bereit/)).toBeTruthy()
    expect(screen.getAllByText(/dieses Gerät/)).toHaveLength(1)
  })

  it('says what is wrong in words, and a missing host or an out-of-date primary as a hint', () => {
    overview.value = {
      rows: [row({ state: 'outdated', status: 'warning', epoch: 1 }), row({ hostId: 'stage-pc', role: 'backup', state: 'host', epoch: 2, url: 'https://10.0.0.2:8443' })],
      problem: null,
    }
    render(<HostOverview />)
    expect(screen.getByText(/veraltet/)).toBeTruthy()
  })

  it('names the problems: no host answers, nobody is the host, two hosts', () => {
    for (const [problem, text] of [['none-reachable', /Kein Host antwortet/], ['no-host', /Keiner der Hosts ist gerade der Host/], ['two-hosts', /Zwei Hosts halten sich für den Host/]] as const) {
      overview.value = { rows: [row({ state: 'unreachable', status: 'warning', epoch: null })], problem }
      const { unmount } = render(<HostOverview />)
      expect(screen.getByText(text)).toBeTruthy()
      unmount()
    }
  })

  it('shows the epoch of a host that answered, and none for one that did not', () => {
    overview.value = { rows: [row({ epoch: 4 }), row({ hostId: 'stage-pc', role: 'backup', state: 'unreachable', status: 'warning', epoch: null })], problem: null }
    render(<HostOverview />)
    expect(screen.getByText(/Epoch 4/)).toBeTruthy()
    expect(screen.queryAllByText(/Epoch/)).toHaveLength(1)
  })

  describe('by hand (#943)', () => {
    const backupStanding = () => ({
      rows: [row({ state: 'host', current: true }), row({ hostId: 'stage-pc', role: 'backup', state: 'standby', status: 'off', url: 'https://10.0.0.2:8443' })],
      problem: null,
    })
    const primaryOutdated = () => ({
      rows: [row({ state: 'outdated', status: 'warning', url: 'https://10.0.0.1:8443' }), row({ hostId: 'stage-pc', role: 'backup', state: 'host', url: 'https://10.0.0.2:8443' })],
      problem: null,
    })

    it('the admin can take over now on the backup that stands by: asked first, sent to the BACKUP, with their login', async () => {
      overview.value = backupStanding()
      render(<HostOverview />)
      fireEvent.click(screen.getByRole('button', { name: /Jetzt übernehmen/ }))
      await waitFor(() => expect(action.run).toHaveBeenCalledTimes(1))
      expect(dialogs.confirm).toHaveBeenCalled()
      expect(action.run).toHaveBeenCalledWith('https://10.0.0.2:8443', 'take-over', { adminUsername: 'stageboard-w-a~d', adminPassword: 'secret' })
    })

    it('does nothing when the admin says no to the question', async () => {
      overview.value = backupStanding()
      dialogs.confirm.mockResolvedValue(false)
      render(<HostOverview />)
      fireEvent.click(screen.getByRole('button', { name: /Jetzt übernehmen/ }))
      await waitFor(() => expect(dialogs.confirm).toHaveBeenCalled())
      expect(action.run).not.toHaveBeenCalled()
    })

    it('the admin can hand back now when the primary is back and out of date: sent to the PRIMARY', async () => {
      overview.value = primaryOutdated()
      render(<HostOverview />)
      fireEvent.click(screen.getByRole('button', { name: /Jetzt zurückgeben/ }))
      await waitFor(() => expect(action.run).toHaveBeenCalledTimes(1))
      expect(action.run).toHaveBeenCalledWith('https://10.0.0.1:8443', 'hand-back', expect.objectContaining({ adminUsername: 'stageboard-w-a~d' }))
    })

    it('says when the host did not accept, and does not pretend', async () => {
      overview.value = backupStanding()
      action.run.mockResolvedValue('denied')
      render(<HostOverview />)
      fireEvent.click(screen.getByRole('button', { name: /Jetzt übernehmen/ }))
      await waitFor(() => expect(dialogs.alert).toHaveBeenCalled())
    })

    it('offers nothing to a member, and nothing where it makes no sense (the host itself, an unreachable host)', () => {
      session.isAdmin = false
      overview.value = backupStanding()
      render(<HostOverview />)
      expect(screen.queryByRole('button')).toBeNull()
    })

    it('no take-over button on the host that is the host, none for a host that does not answer', () => {
      overview.value = { rows: [row({ state: 'host' }), row({ hostId: 'stage-pc', role: 'backup', state: 'unreachable', status: 'warning', epoch: null, url: 'https://10.0.0.2:8443' })], problem: null }
      render(<HostOverview />)
      expect(screen.queryByRole('button')).toBeNull()
    })

    it('says that handing back waits for the end of the song, while one plays', () => {
      session.playing = true
      overview.value = primaryOutdated()
      render(<HostOverview />)
      expect(screen.getByText(/nach dem Song/)).toBeTruthy()
    })
  })
})

