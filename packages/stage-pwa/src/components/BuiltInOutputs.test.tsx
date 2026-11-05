import { fireEvent, render, screen, within } from '@testing-library/react'
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
const { usePluginsStore } = await import('../store/usePluginsStore')
const { BuiltInOutputs } = await import('./BuiltInOutputs')

const save = vi.fn(async () => {})
const remove = vi.fn(async () => {})

function setRoles(devices: LogicalDevice[]) {
  useLogicalDevicesStore.setState({ devices, save, remove } as never)
}

const tablet = (id: string, name: string) => ({ id, name, lastSeenAt: 0, firstSeenAt: 0, revoked: false })

beforeEach(() => {
  save.mockClear()
  remove.mockClear()
  useDevicesStore.setState({ devices: [tablet('xiaomi', 'Xiaomi Pad'), tablet('fire', 'Fire')] } as never)
  setRoles([])
})

/** The chip of a tablet in an output's row. */
const chip = (label: string, name: string) => within(screen.getByRole('group', { name: `${label} - spielt auf` })).getByRole('button', { name })

describe('BuiltInOutputs (System split, 2026-10-16)', () => {
  it('without a role both play on the device running the show; ticking a tablet creates the role, no plugin needed', () => {
    render(<BuiltInOutputs />)
    expect(chip('Klick', 'Xiaomi Pad')).toHaveAttribute('aria-pressed', 'false')
    expect(within(screen.getByRole('group', { name: 'Backing-Track - spielt auf' })).getByText('Keins gewählt: Gerät, das die Show führt')).toBeInTheDocument()
    fireEvent.click(chip('Backing-Track', 'Xiaomi Pad'))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Backing-Track', capability: CAPABILITIES.audioPlayback, pluginId: null, executionTarget: 'xiaomi' }))
  })

  it('an old Mock Playback role on a tablet that left shows "unbekanntes Gerät"; unticking it drops the stand-in', () => {
    const role: LogicalDevice = { id: 'r1', name: 'Mock Playback', capability: CAPABILITIES.audioPlayback, pluginId: 'mock-playback', executionTarget: 'bobberihno' }
    setRoles([role])
    render(<BuiltInOutputs />)
    const unknown = chip('Backing-Track', 'unbekanntes Gerät')
    expect(unknown).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(unknown)
    // The last role stays, without a tablet - the device running the show plays it again.
    expect(save).toHaveBeenCalledWith({ ...role, pluginId: null, executionTarget: null })
    expect(remove).not.toHaveBeenCalled()
  })

  it('the click on several tablets (2026-11-04): one role per tablet, a role without one is reused, unticking one of several removes it', () => {
    const fire: LogicalDevice = { id: 'c1', name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: 'fire' }
    setRoles([fire])
    const { unmount } = render(<BuiltInOutputs />)
    expect(chip('Klick', 'Fire')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(chip('Klick', 'Xiaomi Pad'))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ capability: CAPABILITIES.clickTrack, executionTarget: 'xiaomi' }))
    expect(save).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }))
    unmount()

    const xiaomi: LogicalDevice = { id: 'c2', name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: 'xiaomi' }
    setRoles([fire, xiaomi])
    const second = render(<BuiltInOutputs />)
    expect(chip('Klick', 'Fire')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Klick', 'Xiaomi Pad')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(chip('Klick', 'Fire'))
    expect(remove).toHaveBeenCalledWith('c1')
    second.unmount()

    save.mockClear()
    setRoles([{ ...fire, executionTarget: null }])
    render(<BuiltInOutputs />)
    fireEvent.click(chip('Klick', 'Xiaomi Pad'))
    expect(save).toHaveBeenCalledWith({ ...fire, executionTarget: 'xiaomi' })
  })

  it('Ansagen only with its add-on; without a tablet they come with the click', () => {
    const { unmount } = render(<BuiltInOutputs />)
    expect(screen.queryByRole('group', { name: 'Ansagen - spielt auf' })).not.toBeInTheDocument()
    unmount()
    usePluginsStore.setState({ installed: [{ id: 'section-announcements', capabilities: [CAPABILITIES.sectionAnnouncements], enabled: true }] } as never)
    render(<BuiltInOutputs />)
    expect(screen.getByText('Keins gewählt: wie der Klick')).toBeInTheDocument()
    fireEvent.click(chip('Ansagen', 'Xiaomi Pad'))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ capability: CAPABILITIES.sectionAnnouncements, executionTarget: 'xiaomi', pluginId: null }))
    usePluginsStore.setState({ installed: [] } as never)
  })
})
