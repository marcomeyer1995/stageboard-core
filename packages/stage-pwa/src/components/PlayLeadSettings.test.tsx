import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'

const save = vi.fn(async () => {})
vi.mock('../store/useBandSettingsStore', async () => {
  const { create } = await import('zustand')
  return { useBandSettingsStore: create(() => ({ settings: { id: 'band' } as { id: 'band'; playLeadMs?: number }, save })) }
})
vi.mock('../store/useDevicesStore', () => ({
  useDevicesStore: (select: (state: unknown) => unknown) => select({ devices: [{ id: 'fire', name: 'Fire' }, { id: 'redmi', name: 'Redmi' }] }),
}))
vi.mock('../store/useWorkspaceStore', async () => {
  const { create } = await import('zustand')
  return { useWorkspaceStore: create(() => ({ activeWorkspaceId: 'band-a', workspaces: [{ id: 'band-a', isAdmin: true }] })) }
})
vi.mock('../lib/fetchDeviceInfo', () => ({ fetchDeviceInfo: async () => null }))

const { useBandSettingsStore } = await import('../store/useBandSettingsStore')
const { useDeviceInfoStore } = await import('../store/useDeviceInfoStore')
const { PlayLeadSettings } = await import('./PlayLeadSettings')

const entry = (leadNeededMs: number | null) => ({ ip: '1', os: 'Android-Tablet', environment: 'native' as const, syncStatus: 'idle' as const, lastSeenAt: 0, networkReachable: null, hostname: null, leadNeededMs })

beforeEach(() => {
  save.mockClear()
  useBandSettingsStore.setState({ settings: { id: 'band' } })
})

describe('PlayLeadSettings', () => {
  it('names the device that needed more than the setting, with the value to set', () => {
    render(<PlayLeadSettings />)
    act(() => useDeviceInfoStore.setState({ deviceInfo: { devices: { fire: entry(943), redmi: entry(512) } } }))
    expect(screen.getByText('Fire brauchte zuletzt 943 ms - Vorlauf auf mindestens 1000 ms erhöhen.')).toBeInTheDocument()
  })

  it('says it is enough when every device managed, and saves a new value band-wide', () => {
    useBandSettingsStore.setState({ settings: { id: 'band', playLeadMs: 1000 } })
    render(<PlayLeadSettings />)
    act(() => useDeviceInfoStore.setState({ deviceInfo: { devices: { fire: entry(943), redmi: entry(512) } } }))
    expect(screen.getByText('Reicht: höchstens 943 ms gebraucht (Fire).')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Größer' }))
    expect(save).toHaveBeenCalledWith({ id: 'band', playLeadMs: 1100 })
  })
})
