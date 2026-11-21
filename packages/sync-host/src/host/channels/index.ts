import type { DeviceStateEvent, DeviceTrigger, DiscoverySession, OscInMessage, PluginHealth, PluginHealthEntry, Presence, ShowStatePush, SwitchStateEvent, DetectedHardware } from 'shared-types'
import type { HostPresence } from '../presence.js'
import * as showState from './showStatePushHub.js'
import * as switchState from './switchStateHub.js'
import * as oscIn from './oscInHub.js'
import * as relay from './deviceRelay.js'
import * as health from './healthStore.js'
import * as discovery from './discoverySessionStore.js'
import * as deviceState from './deviceStateHub.js'
import type { StateField } from 'shared-types'

/**
 * The live channels of a host (#962, step 2): show state, switch states, plugin health, presence, OSC in, the
 * point-to-point device trigger and Discovery Mode - **one port**, the same on every host. A transport only carries
 * what the channels say: the laptop writes each snapshot as a host-sent event, the tablet's native host relays
 * the same topics. Nothing of a channel is platform code; whether a device may *feed* one (OSC needs a UDP port,
 * Discovery a MIDI port) is a capability of the device (`GET /host/capabilities`), not of the channel.
 */
export type ChannelTopic = 'show-state' | 'switch-state' | 'presence' | 'plugin-health' | 'osc-in' | 'discovery' | 'device-state'

export type ChannelPayload = {
  'show-state': ShowStatePush
  'switch-state': SwitchStateEvent
  presence: Presence
  'plugin-health': PluginHealth
  'osc-in': OscInMessage
  discovery: DiscoverySession
  /** The latest value of a state field of a device an add-on offers (docs/36 §5a); a follower first gets every current one. */
  'device-state': DeviceStateEvent
}

export interface HostChannels {
  /** Follows a band's topic; the snapshot topics (presence, plugin-health, discovery, switch-state) answer at once with the current state. */
  subscribe<T extends ChannelTopic>(topic: T, workspaceId: string, listener: (payload: ChannelPayload[T]) => void): () => void
  /** Follows the triggers meant for exactly one device of the band. */
  subscribeDevice(workspaceId: string, deviceId: string, listener: (trigger: DeviceTrigger) => void): () => void
  /** How many devices got it. */
  pushShowState(workspaceId: string, push: ShowStatePush): number
  pushSwitchState(workspaceId: string, event: SwitchStateEvent): number
  pushOscIn(workspaceId: string, message: OscInMessage): number
  /** An add-on's device published a value: kept and shared if it fits the field the add-on declared, else refused with the reason. */
  publishDeviceState(workspaceId: string, event: DeviceStateEvent, declared: Readonly<Record<string, StateField>>): deviceState.PublishResult
  /** Whether the device was connected to get it. */
  triggerDevice(workspaceId: string, deviceId: string, trigger: DeviceTrigger): boolean
  setPluginHealth(workspaceId: string, pluginName: string, entry: PluginHealthEntry): void
  discovery: {
    start(workspaceId: string, startedBy: string | null): Promise<void>
    stop(workspaceId: string): void
    reportCandidate(workspaceId: string, reporterId: string, detected: DetectedHardware): void
    reportTriggered(workspaceId: string, reporterId: string, hardwareKey: string): void
    assign(workspaceId: string, reporterId: string, hardwareKey: string, logicalDeviceId: string): void
  }
}

export function createHostChannels(deps: { presence: HostPresence; readBandDocs: discovery.ReadBandDocs }): HostChannels {
  const subscribe = (topic: ChannelTopic, workspaceId: string, listener: (payload: never) => void): (() => void) => {
    const fn = listener as (payload: unknown) => void
    switch (topic) {
      case 'show-state':
        return showState.subscribe(workspaceId, fn)
      case 'switch-state':
        return switchState.subscribe(workspaceId, fn)
      case 'presence':
        return deps.presence.subscribe(workspaceId, fn)
      case 'plugin-health':
        return health.subscribe(workspaceId, fn)
      case 'osc-in':
        return oscIn.subscribe(workspaceId, fn)
      case 'discovery':
        return discovery.subscribe(workspaceId, fn)
      case 'device-state':
        return deviceState.subscribe(workspaceId, fn)
    }
  }
  return {
    subscribe: subscribe as HostChannels['subscribe'],
    subscribeDevice: (workspaceId, deviceId, listener) => relay.subscribe(workspaceId, deviceId, listener),
    pushShowState: showState.broadcast,
    pushSwitchState: (workspaceId, event) => switchState.broadcast(workspaceId, event),
    pushOscIn: oscIn.broadcast,
    publishDeviceState: deviceState.publish,
    triggerDevice: relay.relay,
    setPluginHealth: health.setEntry,
    discovery: {
      start: (workspaceId, startedBy) => discovery.start(deps.readBandDocs, workspaceId, startedBy),
      stop: discovery.stop,
      reportCandidate: discovery.reportCandidate,
      reportTriggered: discovery.reportTriggered,
      assign: discovery.assign,
    },
  }
}

/** The stream a path names (`/workspaces/<band>/show-state/stream`, `/plugin-health/<band>/stream`, ...): what a transport opens. */
export type ChannelStream = { topic: ChannelTopic; workspaceId: string } | { topic: 'device-trigger'; workspaceId: string; deviceId: string }

export function matchChannelStream(path: string): ChannelStream | null {
  const decode = (part: string): string => {
    try {
      return decodeURIComponent(part)
    } catch {
      return ''
    }
  }
  const band = /^\/workspaces\/([^/]+)\/(show-state|switch-state|presence|osc-in|discovery)\/stream$/.exec(path)
  if (band) return { topic: band[2] as ChannelTopic, workspaceId: decode(band[1]!) }
  const health = /^\/plugin-health\/([^/]+)\/stream$/.exec(path)
  if (health) return { topic: 'plugin-health', workspaceId: decode(health[1]!) }
  const device = /^\/workspaces\/([^/]+)\/devices\/([^/]+)\/trigger-stream$/.exec(path)
  if (device) return { topic: 'device-trigger', workspaceId: decode(device[1]!), deviceId: decode(device[2]!) }
  return null
}

export { __resetForTests as __resetShowStateHub } from './showStatePushHub.js'
export { __resetForTests as __resetSwitchStateHub, HOLD_TIMEOUT_MS } from './switchStateHub.js'
export { __resetForTests as __resetOscInHub } from './oscInHub.js'
export { __resetDeviceRelayForTests } from './deviceRelay.js'
export { __resetHealthStoreForTests, getSnapshot as getPluginHealth } from './healthStore.js'
export { __resetDiscoverySessionStoreForTests, getSnapshot as getDiscoverySnapshot, getPlugin as getDiscoveryPlugin, type ReadBandDocs } from './discoverySessionStore.js'
