import { render, screen } from '@testing-library/react'
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

describe('HardwareSetupManager (System cleanup 2026-10-16)', () => {
  it('names the tablet a role runs on, never its internal id', () => {
    const id = '2cf65296-f9df-477d-b737-c878531022e6'
    useDevicesStore.setState({ devices: [{ id, name: 'Xiaomi Redmi Pad', lastSeenAt: 1, firstSeenAt: 1, revoked: false }] })
    useLogicalDevicesStore.setState({
      devices: [
        { id: 'a', name: 'Click', capability: 'click-track', pluginId: null, executionTarget: id },
        { id: 'b', name: 'Track', capability: 'audio-playback', pluginId: null, executionTarget: 'gone-0ac79ff5' },
      ],
    } as never)
    render(<HardwareSetupManager />)
    expect(screen.getByText(/Xiaomi Redmi Pad/)).toBeInTheDocument()
    expect(screen.getByText(/unbekanntes Gerät/)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(id))).not.toBeInTheDocument()
  })
})
