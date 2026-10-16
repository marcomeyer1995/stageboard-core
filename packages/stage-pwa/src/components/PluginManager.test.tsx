import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { PluginManager } = await import('./PluginManager')
const { usePluginsStore } = await import('../store/usePluginsStore')
const { useDialogStore } = await import('../store/useDialogStore')

const plugin = (id: string, name: string, capabilities: string[]) => ({ id, name, version: '0.0.1', runtime: 'client', capabilities, transports: [], hardwareIds: [], enabled: true, installedAt: 1 })

describe('PluginManager (System cleanup 2026-10-16)', () => {
  it('shows readable capabilities, marks test plugins, and removes only after asking, from ⋯', async () => {
    const uninstall = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    useDialogStore.setState({ confirm } as never)
    usePluginsStore.setState({ installed: [plugin('mock-mixer', 'Mock Mixer', ['mixer']), plugin('midi-clock', 'MIDI-Clock', ['midi-clock'])], uninstall } as never)
    render(<PluginManager />)

    expect(screen.getByText(/Mischpult ·/)).toBeInTheDocument()
    expect(screen.getAllByText('Test')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Menü: Mock Mixer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))
    await waitFor(() => expect(uninstall).toHaveBeenCalledWith('mock-mixer'))
    expect(confirm).toHaveBeenCalled()
  })
})
