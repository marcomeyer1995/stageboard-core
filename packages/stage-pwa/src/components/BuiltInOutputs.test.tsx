import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPABILITIES, type LogicalDevice } from 'shared-types'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')
const { useDevicesStore } = await import('../store/useDevicesStore')
const { BuiltInOutputs } = await import('./BuiltInOutputs')

const save = vi.fn(async () => {})

function setRoles(devices: LogicalDevice[]) {
  useLogicalDevicesStore.setState({ devices, save } as never)
}

beforeEach(() => {
  save.mockClear()
  useDevicesStore.setState({ devices: [{ id: 'xiaomi', name: 'Xiaomi Pad', lastSeenAt: 0, firstSeenAt: 0, revoked: false }] } as never)
  setRoles([])
})

describe('BuiltInOutputs (System split, 2026-10-16)', () => {
  it('without a role both play on the device running the show; picking a tablet creates the role, no plugin needed', () => {
    render(<BuiltInOutputs />)
    expect(screen.getByLabelText('Klick')).toHaveValue('')
    expect(screen.getByLabelText('Backing-Track')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Backing-Track'), { target: { value: 'xiaomi' } })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Backing-Track', capability: CAPABILITIES.audioPlayback, pluginId: null, executionTarget: 'xiaomi' }))
  })

  it('an old Mock Playback role on a tablet that left shows "unbekanntes Gerät"; back to the master drops the stand-in', () => {
    const role: LogicalDevice = { id: 'r1', name: 'Mock Playback', capability: CAPABILITIES.audioPlayback, pluginId: 'mock-playback', executionTarget: 'bobberihno' }
    setRoles([role])
    render(<BuiltInOutputs />)
    const select = screen.getByLabelText('Backing-Track')
    expect(select).toHaveValue('bobberihno')
    expect(screen.getByRole('option', { name: 'unbekanntes Gerät' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: '' } })
    expect(save).toHaveBeenCalledWith({ ...role, pluginId: null, executionTarget: null })
  })
})
