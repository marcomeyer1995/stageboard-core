import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import '../i18n'

const save = vi.fn().mockResolvedValue(undefined)
const bandState = vi.hoisted(() => ({ hosts: undefined as BandHostEntry[] | undefined }))
vi.mock('../store/useBandSettingsStore', async () => {
  const { create } = await import('zustand')
  const store = create(() => ({ settings: { id: 'band' as const }, save }))
  return { useBandSettingsStore: Object.assign((select: (s: unknown) => unknown) => select({ settings: { id: 'band', hosts: bandState.hosts }, save }), store) }
})
const playing = vi.hoisted(() => ({ value: false }))
vi.mock('../store/useShowStateStore', () => ({
  useShowStateStore: (select: (s: unknown) => unknown) => select({ state: { playbackStatus: playing.value ? 'playing' : 'stopped' } }),
}))
const promptText = vi.fn<(_title: string, _opts?: Record<string, unknown>) => Promise<string | null>>()
const alert = vi.fn().mockResolvedValue(undefined)
vi.mock('../store/useDialogStore', () => ({
  useDialogStore: (select: (s: unknown) => unknown) => select({ promptText, alert }),
}))
const fetchBandHost = vi.fn()
vi.mock('../lib/fetchBandHost', () => ({ fetchBandHost: (input: string) => fetchBandHost(input) }))
vi.mock('../lib/stageServer', () => ({ getStageServerUrl: () => 'https://paired.local' }))
const ask = vi.hoisted(() => ({ run: vi.fn(async (input: Record<string, unknown>) => (input ? 'done' : 'done') as string) }))
vi.mock('../lib/joinFromMap', () => ({ askBackupToJoin: ask.run }))
const workspace = vi.hoisted(() => ({ id: 'leasetest' as string | null }))
vi.mock('../store/useWorkspaceStore', () => ({
  useWorkspaceStore: (select: (s: unknown) => unknown) => select({ activeWorkspaceId: workspace.id, workspaces: [{ id: 'leasetest', username: 'a' }] }),
}))

const { HostRole } = await import('./HostRole')

const BOX = 'box-laptop'
const HOST = { hostId: 'laptop', url: 'https://10.0.0.1:8443', certFingerprint: 'a'.repeat(64) }

beforeEach(() => {
  ask.run.mockClear()
  ask.run.mockResolvedValue('done')
  workspace.id = 'leasetest'
  save.mockClear()
  promptText.mockReset()
  alert.mockClear()
  fetchBandHost.mockReset()
  bandState.hosts = undefined
  playing.value = false
})

describe('HostRole (#914)', () => {
  it('sets the box as primary: asks the address (the paired server pre-filled), reads the host, saves it with the box', async () => {
    promptText.mockResolvedValue('https://paired.local')
    fetchBandHost.mockResolvedValue(HOST)
    render(<HostRole boxId={BOX} canEdit />)
    fireEvent.click(screen.getByRole('button', { name: /Primary/ }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(promptText.mock.calls[0]![1]).toMatchObject({ defaultValue: 'https://paired.local' })
    expect(save.mock.calls[0]![0].hosts).toEqual([{ ...HOST, equipmentId: BOX, priority: 1 }])
  })

  it('asks the backup address with nothing pre-filled', async () => {
    promptText.mockResolvedValue(null)
    render(<HostRole boxId={BOX} canEdit />)
    fireEvent.click(screen.getByRole('button', { name: /Backup/ }))
    await waitFor(() => expect(promptText).toHaveBeenCalled())
    expect(promptText.mock.calls[0]![1]).toMatchObject({ defaultValue: '' })
    expect(save).not.toHaveBeenCalled()
  })

  it('writes nothing and says so when the host does not answer', async () => {
    promptText.mockResolvedValue('10.0.0.9')
    fetchBandHost.mockResolvedValue(null)
    render(<HostRole boxId={BOX} canEdit />)
    fireEvent.click(screen.getByRole('button', { name: /Backup/ }))
    await waitFor(() => expect(alert).toHaveBeenCalled())
    expect(save).not.toHaveBeenCalled()
  })

  it('shows the box\'s role, and removing it keeps the other host', async () => {
    bandState.hosts = [
      { ...HOST, equipmentId: BOX, priority: 1 },
      { hostId: 'stage-pc', url: 'https://10.0.0.2:8443', priority: 2 },
    ]
    render(<HostRole boxId={BOX} canEdit />)
    expect(screen.getByText('Primary')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /entfernen/i }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0]![0].hosts.map((h: BandHostEntry) => h.hostId)).toEqual(['stage-pc'])
  })

  it('offers no change to a non-admin, only the role', () => {
    bandState.hosts = [{ ...HOST, equipmentId: BOX, priority: 2 }]
    render(<HostRole boxId={BOX} canEdit={false} />)
    expect(screen.getByText('Backup')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is locked while a song plays', () => {
    playing.value = true
    render(<HostRole boxId={BOX} canEdit />)
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  describe('joining the backup from the map (#945)', () => {
    const backup = { hostId: 'stage-pc', url: 'https://10.0.0.2:8443', certFingerprint: 'b'.repeat(64) }

    it('asks for the address AND the band code, saves the role, then asks the backup to join - with the paired primary', async () => {
      promptText.mockResolvedValueOnce('https://10.0.0.2:8443').mockResolvedValueOnce('12345678')
      fetchBandHost.mockResolvedValue(backup)
      render(<HostRole boxId={BOX} canEdit />)
      fireEvent.click(screen.getByRole('button', { name: /Backup/ }))

      await waitFor(() => expect(ask.run).toHaveBeenCalledTimes(1))
      expect(promptText).toHaveBeenCalledTimes(2)
      expect(promptText.mock.calls[1]![0]).toMatch(/[Cc]ode/)
      expect(save).toHaveBeenCalledTimes(1)
      expect(ask.run.mock.calls[0]![0]).toMatchObject({
        workspaceId: 'leasetest',
        accessCode: '12345678',
        primaryUrl: 'https://paired.local',
        primaryHostId: 'paired.local',
        targetHostId: 'stage-pc',
        targetUrl: 'https://10.0.0.2:8443',
        fingerprint: 'b'.repeat(64),
      })
    })

    it('saves the role but does not join when the admin cancels the code question', async () => {
      promptText.mockResolvedValueOnce('https://10.0.0.2:8443').mockResolvedValueOnce(null)
      fetchBandHost.mockResolvedValue(backup)
      render(<HostRole boxId={BOX} canEdit />)
      fireEvent.click(screen.getByRole('button', { name: /Backup/ }))
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
      expect(ask.run).not.toHaveBeenCalled()
    })

    it('does not join when the host does not answer', async () => {
      promptText.mockResolvedValueOnce('https://10.0.0.2:8443')
      fetchBandHost.mockResolvedValue(null)
      render(<HostRole boxId={BOX} canEdit />)
      fireEvent.click(screen.getByRole('button', { name: /Backup/ }))
      await waitFor(() => expect(alert).toHaveBeenCalled())
      expect(ask.run).not.toHaveBeenCalled()
    })

    it('never joins on "Set as primary"', async () => {
      promptText.mockResolvedValueOnce('https://paired.local')
      fetchBandHost.mockResolvedValue(HOST)
      render(<HostRole boxId={BOX} canEdit />)
      fireEvent.click(screen.getByRole('button', { name: /Primary/ }))
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
      expect(ask.run).not.toHaveBeenCalled()
      expect(promptText).toHaveBeenCalledTimes(1)
    })

    it('says when the backup did not accept the code or is unreachable', async () => {
      promptText.mockResolvedValueOnce('https://10.0.0.2:8443').mockResolvedValueOnce('wrong')
      fetchBandHost.mockResolvedValue(backup)
      ask.run.mockResolvedValue('code-refused')
      render(<HostRole boxId={BOX} canEdit />)
      fireEvent.click(screen.getByRole('button', { name: /Backup/ }))
      await waitFor(() => expect(alert).toHaveBeenCalled())
    })

    it('needs an active band to know its code', async () => {
      workspace.id = null
      promptText.mockResolvedValueOnce('https://10.0.0.2:8443').mockResolvedValueOnce('12345678')
      fetchBandHost.mockResolvedValue(backup)
      render(<HostRole boxId={BOX} canEdit />)
      fireEvent.click(screen.getByRole('button', { name: /Backup/ }))
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
      expect(ask.run).not.toHaveBeenCalled()
    })
  })
})

