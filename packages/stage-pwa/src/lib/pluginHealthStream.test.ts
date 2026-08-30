import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PLUGIN_HEALTH } from 'shared-types'
import { subscribeToPluginHealth } from './pluginHealthStream'

/** Minimal stand-in for the browser's EventSource - happy-dom doesn't implement it, and the
 * real thing needs a live server anyway. Captures the constructed URL and lets a test fire
 * a message, mirroring trackedSync.test.ts's fakeSyncHandle pattern for the same reason. */
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

describe('subscribeToPluginHealth', () => {
  it('opens a stream scoped to the workspace and forwards parsed snapshots', () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    const onHealth = vi.fn()

    subscribeToPluginHealth('band-a', onHealth)

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe('https://stage.example/plugin-health/band-a/stream')

    const snapshot = { plugins: { 'mock-mixer': { status: 'online', lastSeenAt: 123 } } }
    FakeEventSource.instances[0].emit(snapshot)

    expect(onHealth).toHaveBeenCalledWith(snapshot)
  })

  it('ignores a malformed payload instead of throwing', () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    const onHealth = vi.fn()

    subscribeToPluginHealth('band-a', onHealth)
    FakeEventSource.instances[0].onmessage?.({ data: 'not json' })

    expect(onHealth).not.toHaveBeenCalled()
  })

  it('closes the underlying stream on unsubscribe', () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    const unsubscribe = subscribeToPluginHealth('band-a', vi.fn())

    unsubscribe()

    expect(FakeEventSource.instances[0].closed).toBe(true)
  })

  it('reports the default health and opens nothing when no Stage-Server is configured', () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', '')
    const onHealth = vi.fn()

    subscribeToPluginHealth('band-a', onHealth)

    expect(FakeEventSource.instances).toHaveLength(0)
    expect(onHealth).toHaveBeenCalledWith(DEFAULT_PLUGIN_HEALTH)
  })
})
