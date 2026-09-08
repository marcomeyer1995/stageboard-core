import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device } from 'shared-types'

// useWorkspaceStore.ts (needed here for the revoke() tests) transitively imports
// workspaceDb.ts, which constructs a real PouchDB at module load time - unavailable under
// happy-dom, same mock as useWorkspaceStore.test.ts's own.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
    destroy() {
      return Promise.resolve()
    }
  },
}))

const getAllDevices = vi.fn()
const putDevice = vi.fn()
const devicesChanges = vi.fn()
const switchDevicesWorkspace = vi.fn()
vi.mock('../lib/devicesDb', () => ({
  getAllDevices: (...args: unknown[]) => getAllDevices(...args),
  putDevice: (...args: unknown[]) => putDevice(...args),
  devicesChanges: (...args: unknown[]) => devicesChanges(...args),
  switchDevicesWorkspace: (...args: unknown[]) => switchDevicesWorkspace(...args),
}))

vi.mock('../lib/deviceId', () => ({ getDeviceId: () => 'this-device' }))
vi.mock('../lib/guessDeviceName', () => ({ guessDeviceName: () => 'iPad' }))

const { useDevicesStore } = await import('./useDevicesStore')
const { useWorkspaceStore } = await import('./useWorkspaceStore')
const { useDialogStore } = await import('./useDialogStore')

function stubFetch(response: Partial<Response> | null) {
  const fetchMock = response ? vi.fn().mockResolvedValue(response as Response) : vi.fn().mockRejectedValue(new Error('network down'))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  getAllDevices.mockReset().mockResolvedValue([])
  putDevice.mockReset().mockResolvedValue(undefined)
  devicesChanges.mockReset().mockReturnValue({ on: vi.fn(), cancel: vi.fn() })
  switchDevicesWorkspace.mockReset()
  useWorkspaceStore.setState({ workspaces: [] })
  useDialogStore.setState({ alert: vi.fn().mockResolvedValue(undefined) })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('init', () => {
  it('stamps both lastSeenAt and firstSeenAt when registering this device for the first time', async () => {
    getAllDevices.mockResolvedValue([])
    const before = Date.now()

    await useDevicesStore.getState().init('band-a')

    expect(putDevice).toHaveBeenCalledOnce()
    const written = putDevice.mock.calls[0][0] as Device
    expect(written).toMatchObject({ id: 'this-device', name: 'iPad', revoked: false })
    expect(written.lastSeenAt).toBeGreaterThanOrEqual(before)
    expect(written.firstSeenAt).toBeGreaterThanOrEqual(before)
  })

  it('does not write again for an already-registered, recently-seen device', async () => {
    getAllDevices.mockResolvedValue([{ id: 'this-device', name: 'iPad', lastSeenAt: Date.now(), firstSeenAt: 1, revoked: false }])

    await useDevicesStore.getState().init('band-a')

    expect(putDevice).not.toHaveBeenCalled()
  })

  it('refreshes lastSeenAt but preserves firstSeenAt for a stale, already-registered device', async () => {
    const staleDevice: Device = { id: 'this-device', name: 'iPad', lastSeenAt: 0, firstSeenAt: 500, revoked: false }
    getAllDevices.mockResolvedValue([staleDevice])

    await useDevicesStore.getState().init('band-a')

    expect(putDevice).toHaveBeenCalledOnce()
    const written = putDevice.mock.calls[0][0] as Device
    expect(written.firstSeenAt).toBe(500)
    expect(written.lastSeenAt).toBeGreaterThan(0)
  })
})

describe('rename', () => {
  it('preserves firstSeenAt/revoked - not just lastSeenAt - when renaming an existing device', async () => {
    useDevicesStore.setState({ devices: [{ id: 'd1', name: 'Old Name', lastSeenAt: 100, firstSeenAt: 50, revoked: true }] })

    await useDevicesStore.getState().rename('d1', 'New Name')

    expect(putDevice).toHaveBeenCalledWith({ id: 'd1', name: 'New Name', lastSeenAt: 100, firstSeenAt: 50, revoked: true })
  })
})

describe('revoke', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage-server:3001')
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'admin-pw', username: 'stageboard-band-a-p1', isAdmin: true }],
    })
  })

  it('posts this workspace\'s own admin credential and the target revoked value', async () => {
    const fetchMock = stubFetch({ ok: true, status: 204 })

    const result = await useDevicesStore.getState().revoke('band-a', 'device-2', true)

    expect(result).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/workspaces/band-a/devices/device-2/revoke')
    expect(JSON.parse(init.body)).toEqual({ adminUsername: 'stageboard-band-a-p1', adminPassword: 'admin-pw', revoked: true })
  })

  it('returns false without calling the Stage-Server when this device is not the workspace admin', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'member-pw', username: 'stageboard-band-a-p2', isAdmin: false }],
    })
    const fetchMock = stubFetch({ ok: true, status: 204 })

    expect(await useDevicesStore.getState().revoke('band-a', 'device-2', true)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('alerts and returns false when the Stage-Server is unreachable', async () => {
    stubFetch(null)

    const result = await useDevicesStore.getState().revoke('band-a', 'device-2', true)

    expect(result).toBe(false)
    expect(useDialogStore.getState().alert).toHaveBeenCalled()
  })
})
