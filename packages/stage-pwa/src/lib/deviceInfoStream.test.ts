import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DEVICE_INFO } from 'shared-types'
import { subscribeToDeviceInfo } from './deviceInfoStream'

/** Minimal stand-in for the browser's EventSource - happy-dom doesn't implement it, same fake
 * as presenceStream.test.ts's own. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  closed = false

  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  close() {
    this.closed = true
  }
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('subscribeToDeviceInfo', () => {
  it('opens a stream scoped to the workspace and forwards parsed snapshots', () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    const onDeviceInfo = vi.fn()

    subscribeToDeviceInfo('band-a', onDeviceInfo)

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe('https://stage.example/workspaces/band-a/device-info/stream')

    const snapshot = {
      devices: {
        'device-1': {
          ip: '192.168.1.10',
          os: 'iPad',
          environment: 'browser',
          syncStatus: 'idle',
          lastSeenAt: 123,
          networkReachable: true,
          hostname: null,
        },
      },
    }
    FakeEventSource.instances[0].emit(snapshot)

    expect(onDeviceInfo).toHaveBeenCalledWith(snapshot)
  })

  it('ignores a malformed payload instead of throwing', () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    const onDeviceInfo = vi.fn()

    subscribeToDeviceInfo('band-a', onDeviceInfo)
    FakeEventSource.instances[0].onmessage?.({ data: 'not json' })

    expect(onDeviceInfo).not.toHaveBeenCalled()
  })

  it('closes the underlying stream on unsubscribe', () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    const unsubscribe = subscribeToDeviceInfo('band-a', vi.fn())

    unsubscribe()

    expect(FakeEventSource.instances[0].closed).toBe(true)
  })

  it('reports the default (empty) device info and opens nothing when no Stage-Server is configured', () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', '')
    const onDeviceInfo = vi.fn()

    subscribeToDeviceInfo('band-a', onDeviceInfo)

    expect(FakeEventSource.instances).toHaveLength(0)
    expect(onDeviceInfo).toHaveBeenCalledWith(DEFAULT_DEVICE_INFO)
  })
})
