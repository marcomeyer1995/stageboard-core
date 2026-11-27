import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChannelRoutes } from './channelRoutes.js'
import { BAND_STREAM_TOPICS, createHostChannels, matchChannelStream } from './channels/index.js'
import * as resets from './channels/resets.js'
import { createHostPresence } from './presence.js'
import { matchHostRoute, type HostRouteResponse } from './routes.js'

const setup = (options: { refuse?: (band: string) => HostRouteResponse | null; device?: boolean } = {}) => {
  const presence = createHostPresence({ now: () => 1 })
  const channels = createHostChannels({ presence, readBandDocs: async () => [] })
  const log = vi.fn()
  const routes = createChannelRoutes({
    channels,
    refuseBand: async (band) => options.refuse?.(band) ?? null,
    isBandDevice: async () => options.device ?? true,
    log,
  })
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const matched = matchHostRoute(routes, method, path)
    if (!matched) throw new Error(`no route ${method} ${path}`)
    return matched.route.handle({ params: matched.params, query: {}, body, authorization: 'Basic x' })
  }
  return { channels, call, log }
}
const push = { deviceId: 'fire', issuedAt: 5, patch: { playbackStatus: 'playing' } }

beforeEach(() => {
  resets.__resetShowStateHub()
  resets.__resetSwitchStateHub()
  resets.__resetOscInHub()
  resets.__resetDeviceRelayForTests()
  resets.__resetHealthStoreForTests()
  resets.__resetDiscoverySessionStoreForTests()
})

describe('live channels as shared routes (#962)', () => {
  it('a show-state push reaches every subscriber of that band only', async () => {
    const { channels, call } = setup()
    const mine = vi.fn()
    const other = vi.fn()
    channels.subscribe('show-state', 'band', mine)
    channels.subscribe('show-state', 'other', other)
    expect((await call('POST', '/workspaces/band/show-state/push', push)).status).toBe(204)
    expect(mine).toHaveBeenCalledWith(push)
    expect(other).not.toHaveBeenCalled()
  })

  it('refuses a push from a login that is no device of the band (401), a bad body (400), and a band the host does not serve', async () => {
    expect((await setup({ device: false }).call('POST', '/workspaces/band/show-state/push', push)).status).toBe(401)
    expect((await setup().call('POST', '/workspaces/band/show-state/push', { nonsense: true })).status).toBe(400)
    const refused = setup({ refuse: () => ({ status: 404, body: { error: 'not_found' } }) })
    expect((await refused.call('POST', '/workspaces/band/switch-state/push', { deviceId: 'a', switchId: 'x', kind: 'on', at: 1 })).status).toBe(404)
  })

  it('a device that connects to switch-state later gets the latched state at once', async () => {
    const { channels, call } = setup()
    await call('POST', '/workspaces/band/switch-state/push', { deviceId: 'a', switchId: 'fx', kind: 'on', at: 1 })
    const late = vi.fn()
    channels.subscribe('switch-state', 'band', late)
    expect(late).toHaveBeenCalledWith({ deviceId: 'a', switchId: 'fx', kind: 'on', at: 1 })
  })

  it('a plugin-health report reaches the stream as a full snapshot, and the stream answers at once on connecting', async () => {
    const { channels, call } = setup()
    const seen = vi.fn()
    channels.subscribe('plugin-health', 'band', seen)
    expect(seen).toHaveBeenLastCalledWith({ plugins: {} })
    expect((await call('POST', '/plugin-health/band/report', { pluginName: 'midi', status: 'online' })).status).toBe(204)
    expect(seen.mock.lastCall?.[0].plugins.midi).toMatchObject({ status: 'online' })
  })

  it('a device trigger goes to exactly the claimed device, and says so when it is not connected', async () => {
    const { channels, call } = setup()
    const trigger = { capability: 'lighting', event: { type: 'cue' } }
    expect((await call('POST', '/workspaces/band/devices/fire/trigger', trigger)).body).toMatchObject({ status: 'error' })
    const fire = vi.fn()
    const phone = vi.fn()
    channels.subscribeDevice('band', 'fire', fire)
    channels.subscribeDevice('band', 'phone', phone)
    expect((await call('POST', '/workspaces/band/devices/fire/trigger', trigger)).body).toEqual({ status: 'ok' })
    expect(fire).toHaveBeenCalledTimes(1)
    expect(phone).not.toHaveBeenCalled()
  })

  it('Discovery runs over the host\'s own documents: a session starts, reports and stops', async () => {
    const { channels, call } = setup()
    const seen = vi.fn()
    channels.subscribe('discovery', 'band', seen)
    expect((await call('POST', '/workspaces/band/discovery/start', { startedBy: 'marco' })).body).toEqual({ status: 'ok' })
    expect(seen.mock.lastCall?.[0]).toMatchObject({ active: true, startedBy: 'marco' })
    await call('POST', '/workspaces/band/discovery/stop')
    expect(seen.mock.lastCall?.[0]).toMatchObject({ active: false })
  })

  it('presence is one of the topics: the host\'s presence store is what the stream follows', () => {
    const presence = createHostPresence({ now: () => 1 })
    const channels = createHostChannels({ presence, readBandDocs: async () => [] })
    const seen = vi.fn()
    channels.subscribe('presence', 'band', seen)
    presence.setMasterHeartbeat('band', 'fire')
    expect(seen.mock.lastCall?.[0].masterHeartbeat).toEqual({ deviceId: 'fire', at: 1 })
  })
})

describe('matchChannelStream', () => {
  it('names the topic and band of every stream path, and nothing else', () => {
    expect(matchChannelStream('/workspaces/band/show-state/stream')).toEqual({ topic: 'show-state', workspaceId: 'band' })
    expect(matchChannelStream('/workspaces/band/osc-in/stream')).toEqual({ topic: 'osc-in', workspaceId: 'band' })
    expect(matchChannelStream('/plugin-health/band/stream')).toEqual({ topic: 'plugin-health', workspaceId: 'band' })
    expect(matchChannelStream('/workspaces/b%20c/devices/fire/trigger-stream')).toEqual({ topic: 'device-trigger', workspaceId: 'b c', deviceId: 'fire' })
    // Every band stream of the one list - device-state was missing here, so a tablet answered it 404 instead of 501.
    for (const topic of BAND_STREAM_TOPICS) expect(matchChannelStream(`/workspaces/band/${topic}/stream`)).toEqual({ topic, workspaceId: 'band' })
    expect(matchChannelStream('/workspaces/band/nonsense/stream')).toBeNull()
    expect(matchChannelStream('/workspaces/band/show-state/push')).toBeNull()
    expect(matchChannelStream('/workspaces/band/roster')).toBeNull()
  })
})
