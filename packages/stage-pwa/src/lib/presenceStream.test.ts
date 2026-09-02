import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PRESENCE } from 'shared-types'
import { subscribeToPresence } from './presenceStream'

/** Minimal stand-in for the browser's EventSource - happy-dom doesn't implement it, and the
 * real thing needs a live server anyway - see pluginHealthStream.test.ts's identical fake. */
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

describe('subscribeToPresence', () => {
  it('opens a stream scoped to the workspace and forwards parsed snapshots', () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    const onPresence = vi.fn()

    subscribeToPresence('band-a', onPresence)

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe('https://stage.example/workspaces/band-a/presence/stream')

    const snapshot = { devices: { 'device-1': { profileId: 'p1', lastSeenAt: 123 } } }
    FakeEventSource.instances[0].emit(snapshot)

    expect(onPresence).toHaveBeenCalledWith(snapshot)
  })

  it('ignores a malformed payload instead of throwing', () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    const onPresence = vi.fn()

    subscribeToPresence('band-a', onPresence)
    FakeEventSource.instances[0].onmessage?.({ data: 'not json' })

    expect(onPresence).not.toHaveBeenCalled()
  })

  it('closes the underlying stream on unsubscribe', () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    const unsubscribe = subscribeToPresence('band-a', vi.fn())

    unsubscribe()

    expect(FakeEventSource.instances[0].closed).toBe(true)
  })

  it('reports the default (empty) presence and opens nothing when no Stage-Server is configured', () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', '')
    const onPresence = vi.fn()

    subscribeToPresence('band-a', onPresence)

    expect(FakeEventSource.instances).toHaveLength(0)
    expect(onPresence).toHaveBeenCalledWith(DEFAULT_PRESENCE)
  })
})
