import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { HardwareSetupManager } = await import('./HardwareSetupManager')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')
const { useDevicesStore } = await import('../store/useDevicesStore')
const { usePluginsStore } = await import('../store/usePluginsStore')
const { useDialogStore } = await import('../store/useDialogStore')

describe('HardwareSetupManager (System cleanup 2026-10-16)', () => {
  it('names the tablet a role runs on, never its internal id', () => {
    const id = '2cf65296-f9df-477d-b737-c878531022e6'
    useDevicesStore.setState({ devices: [{ id, name: 'Xiaomi Redmi Pad', lastSeenAt: 1, firstSeenAt: 1, revoked: false }] })
    useLogicalDevicesStore.setState({
      devices: [
        { id: 'a', name: 'Kemper', capability: 'midi-input', pluginId: null, executionTarget: id },
        { id: 'b', name: 'Licht', capability: 'lighting', pluginId: null, executionTarget: 'gone-0ac79ff5' },
      ],
    } as never)
    render(<HardwareSetupManager />)
    expect(screen.getByText(/· Xiaomi Redmi Pad/)).toBeInTheDocument()
    expect(screen.getByText(/unbekanntes Gerät/)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(id))).not.toBeInTheDocument()
  })

  it('Klick and Backing-Track are fixed first rows, their old stand-in roles not listed as gear', () => {
    useDevicesStore.setState({ devices: [] })
    useLogicalDevicesStore.setState({
      devices: [{ id: 'k', name: 'Mock Click', capability: 'click-track', pluginId: 'mock-click', executionTarget: null }],
    } as never)
    render(<HardwareSetupManager />)
    expect(screen.getByRole('group', { name: 'Klick' })).toBeInTheDocument()
    expect(screen.queryByText('Treiber')).not.toBeInTheDocument()
    expect(screen.queryByText(/Mock Click/)).not.toBeInTheDocument()
  })

  it('removing the last device of a driver offers to remove the driver too', async () => {
    const remove = vi.fn(async () => {})
    const uninstall = vi.fn(async () => {})
    const confirm = vi.fn().mockResolvedValue(true)
    useDialogStore.setState({ confirm } as never)
    useDevicesStore.setState({ devices: [] })
    usePluginsStore.setState({ installed: [{ id: 'kemper-profiler', name: 'Kemper Profiler', capabilities: ['kemper-control'], transports: [{ kind: 'midi' }], enabled: true }], uninstall } as never)
    useLogicalDevicesStore.setState({ devices: [{ id: 'k', name: 'Marcos Kemper', capability: 'kemper-control', pluginId: 'kemper-profiler', executionTarget: null }], remove } as never)
    render(<HardwareSetupManager />)
    fireEvent.click(screen.getByRole('button', { name: 'Menü: Marcos Kemper' }))
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))
    await waitFor(() => expect(uninstall).toHaveBeenCalledWith('kemper-profiler'))
    expect(remove).toHaveBeenCalledWith('k')
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('Kemper Profiler'), expect.anything())
  })
})
