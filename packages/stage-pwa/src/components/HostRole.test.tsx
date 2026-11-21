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
vi.mock('../lib/hostUrl', () => ({ getHostUrl: () => 'https://paired.local' }))
const { HostRole } = await import('./HostRole')

const BOX = 'box-laptop'
const HOST = { hostId: 'laptop', url: 'https://10.0.0.1:8443', certFingerprint: 'a'.repeat(64) }

beforeEach(() => {
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

  it('asks nothing beyond the address for a backup - the primary teaches the fresh host its band (#945)', async () => {
    promptText.mockResolvedValue('https://10.0.0.2:8443')
    fetchBandHost.mockResolvedValue({ hostId: 'stage-pc', url: 'https://10.0.0.2:8443', certFingerprint: 'b'.repeat(64) })
    render(<HostRole boxId={BOX} canEdit />)
    fireEvent.click(screen.getByRole('button', { name: /Backup/ }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    // No band code, no second dialog: the host list entry is all the admin does.
    expect(promptText).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0].hosts).toEqual([{ hostId: 'stage-pc', url: 'https://10.0.0.2:8443', certFingerprint: 'b'.repeat(64), equipmentId: BOX, priority: 2 }])
  })
})
