import {
  DeviceTriggerSchema,
  DiscoveryAssignRequestSchema,
  DiscoveryReportCandidateRequestSchema,
  DiscoveryStartRequestSchema,
  DiscoveryTriggeredRequestSchema,
  HealthReportSchema,
  ShowStatePushAckSchema,
  ShowStatePushSchema,
  SwitchStateEventSchema,
  hostMessage,
} from 'shared-types'
import type { HostChannels } from './channels/index.js'
import type { HostRoute, HostRouteResponse } from './routes.js'

/**
 * The live channels' routes in the shared table (#962, step 2): what a device sends *into* a channel. What it listens
 * to (`…/stream`) is the transport's job - see `matchChannelStream`.
 */
const safeDecode = (part: string): string => {
  try {
    return decodeURIComponent(part)
  } catch {
    return ''
  }
}
const bad = (message: string | undefined): HostRouteResponse => ({ status: 400, body: { status: 'error', message } })

export interface ChannelRoutesDeps {
  channels: HostChannels
  /** `null` = serve it; else the 404/503 of a band this host does not serve (routes.ts's `refuseBand`). */
  refuseBand: (workspaceId: string) => Promise<HostRouteResponse | null>
  isBandDevice: (workspaceId: string, authorization: string | undefined) => Promise<boolean>
  /** A line for the host's log (the show state's push and ack are what PLAY_LEAD_MS is measured from). */
  log?: (message: string, meta: Record<string, unknown>) => void
}

export function createChannelRoutes(deps: ChannelRoutesDeps): HostRoute[] {
  const { channels, log } = deps
  const band = (request: { params: Record<string, string> }) => safeDecode(request.params.workspaceId ?? '')
  const route = (method: HostRoute['method'], pattern: string, handle: HostRoute['handle']): HostRoute => ({ method, pattern, handle })
  /** Body first (400 tells a stranger nothing), then the band guard; `then` runs for a served band. */
  const guarded = (method: HostRoute['method'], pattern: string, handle: (workspaceId: string, request: Parameters<HostRoute['handle']>[0]) => Promise<HostRouteResponse>): HostRoute =>
    route(method, pattern, async (request) => {
      const workspaceId = band(request)
      const refused = await deps.refuseBand(workspaceId)
      return refused ?? handle(workspaceId, request)
    })

  return [
    route('POST', '/workspaces/:workspaceId/show-state/push', async (request) => {
      const parsed = ShowStatePushSchema.safeParse(request.body)
      if (!parsed.success) return bad(parsed.error.issues[0]?.message)
      const workspaceId = band(request)
      const refused = await deps.refuseBand(workspaceId)
      if (refused) return refused
      // Only a device of this band may change what every tablet plays.
      if (!(await deps.isBandDevice(workspaceId, request.authorization))) return { status: 401, body: { status: 'error', message: 'Only a device of this band can push the show state' } }
      const devices = channels.pushShowState(workspaceId, parsed.data)
      log?.('Show state pushed', { workspaceId, deviceId: parsed.data.deviceId, issuedAt: parsed.data.issuedAt, keys: Object.keys(parsed.data.patch), devices })
      return { status: 204 }
    }),
    route('POST', '/workspaces/:workspaceId/switch-state/push', async (request) => {
      const parsed = SwitchStateEventSchema.safeParse(request.body)
      if (!parsed.success) return bad(parsed.error.issues[0]?.message)
      const workspaceId = band(request)
      const refused = await deps.refuseBand(workspaceId)
      if (refused) return refused
      if (!(await deps.isBandDevice(workspaceId, request.authorization))) return { status: 401, body: { status: 'error', message: 'Only a device of this band can switch' } }
      const devices = channels.pushSwitchState(workspaceId, parsed.data)
      if (parsed.data.kind !== 'held') log?.('Switch state pushed', { workspaceId, ...parsed.data, devices })
      return { status: 204 }
    }),
    route('POST', '/workspaces/:workspaceId/show-state/ack', async (request) => {
      const parsed = ShowStatePushAckSchema.safeParse(request.body)
      if (!parsed.success) return bad(parsed.error.issues[0]?.message)
      const refused = await deps.refuseBand(band(request))
      if (refused) return refused
      const { deviceId, deviceName, issuedAt, receivedAt, via } = parsed.data
      log?.('Show state reached device', { workspaceId: band(request), deviceId, deviceName, issuedAt, via, delayMs: Math.round(receivedAt - issuedAt), remoteAddress: request.remoteAddress })
      return { status: 204 }
    }),
    route('POST', '/plugin-health/:workspaceId/report', async (request) => {
      const parsed = HealthReportSchema.safeParse(request.body)
      if (!parsed.success) return bad(parsed.error.issues[0]?.message)
      const workspaceId = band(request)
      const refused = await deps.refuseBand(workspaceId)
      if (refused) return refused
      channels.setPluginHealth(workspaceId, parsed.data.pluginName, { status: parsed.data.status, lastSeenAt: Date.now(), message: parsed.data.message })
      return { status: 204 }
    }),
    route('POST', '/workspaces/:workspaceId/devices/:deviceId/trigger', async (request) => {
      const parsed = DeviceTriggerSchema.safeParse(request.body)
      if (!parsed.success) return bad(parsed.error.issues[0]?.message)
      const workspaceId = band(request)
      const refused = await deps.refuseBand(workspaceId)
      if (refused) return refused
      return channels.triggerDevice(workspaceId, safeDecode(request.params.deviceId ?? ''), parsed.data)
        ? { status: 200, body: { status: 'ok' } }
        : { status: 200, body: { status: 'error', ...hostMessage('device.notConnected') } }
    }),
    guarded('POST', '/workspaces/:workspaceId/discovery/stop', async (workspaceId) => {
      channels.discovery.stop(workspaceId)
      return { status: 200, body: { status: 'ok' } }
    }),
    route('POST', '/workspaces/:workspaceId/discovery/start', async (request) => {
      const parsed = DiscoveryStartRequestSchema.safeParse(request.body ?? {})
      if (!parsed.success) return bad(parsed.error.issues[0]?.message)
      const workspaceId = band(request)
      const refused = await deps.refuseBand(workspaceId)
      if (refused) return refused
      await channels.discovery.start(workspaceId, parsed.data.startedBy)
      return { status: 200, body: { status: 'ok' } }
    }),
    route('POST', '/workspaces/:workspaceId/discovery/candidates', async (request) => {
      const parsed = DiscoveryReportCandidateRequestSchema.safeParse(request.body)
      if (!parsed.success) return bad(parsed.error.issues[0]?.message)
      const workspaceId = band(request)
      const refused = await deps.refuseBand(workspaceId)
      if (refused) return refused
      channels.discovery.reportCandidate(workspaceId, parsed.data.reporterId, parsed.data.detected)
      return { status: 200, body: { status: 'ok' } }
    }),
    route('POST', '/workspaces/:workspaceId/discovery/triggered', async (request) => {
      const parsed = DiscoveryTriggeredRequestSchema.safeParse(request.body)
      if (!parsed.success) return bad(parsed.error.issues[0]?.message)
      const workspaceId = band(request)
      const refused = await deps.refuseBand(workspaceId)
      if (refused) return refused
      channels.discovery.reportTriggered(workspaceId, parsed.data.reporterId, parsed.data.hardwareKey)
      return { status: 200, body: { status: 'ok' } }
    }),
    route('POST', '/workspaces/:workspaceId/discovery/assign', async (request) => {
      const parsed = DiscoveryAssignRequestSchema.safeParse(request.body)
      if (!parsed.success) return bad(parsed.error.issues[0]?.message)
      const workspaceId = band(request)
      const refused = await deps.refuseBand(workspaceId)
      if (refused) return refused
      channels.discovery.assign(workspaceId, parsed.data.reporterId, parsed.data.hardwareKey, parsed.data.logicalDeviceId)
      return { status: 200, body: { status: 'ok' } }
    }),
  ]
}
