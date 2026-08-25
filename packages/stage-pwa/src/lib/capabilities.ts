import {
  HEALTH_TIMEOUT_MS,
  type CapabilityId,
  type PluginHealth,
  type PluginInstallation,
} from 'shared-types'

/**
 * - `available`: a plugin provides it and is answering right now.
 * - `degraded`: the band installed it, but it is unreachable tonight - the widget stays
 *   in the layout and greys out (docs/07 Graceful Degradation).
 * - `missing`: no enabled plugin provides it at all - the widget is not offered.
 */
export type CapabilityStatus = 'available' | 'degraded' | 'missing'

/**
 * Resolves what the UI may show. Server-side plugins are judged by the heartbeat the
 * Stage-Server writes; client-side ones (WebMIDI is a browser API) by a local probe,
 * because no server can know whether *this* tablet has a foot switch attached.
 */
export function resolveCapabilities(
  installed: PluginInstallation[],
  health: PluginHealth,
  clientProbes: Record<CapabilityId, boolean>,
  now: number,
): Map<CapabilityId, CapabilityStatus> {
  const statuses = new Map<CapabilityId, CapabilityStatus>()

  for (const plugin of installed) {
    if (!plugin.enabled) continue

    for (const capability of plugin.capabilities) {
      const status = pluginStatus(plugin, capability, health, clientProbes, now)
      // A capability several plugins provide is available as soon as one of them works.
      if (status === 'available' || !statuses.has(capability)) {
        statuses.set(capability, status)
      }
    }
  }

  return statuses
}

function pluginStatus(
  plugin: PluginInstallation,
  capability: CapabilityId,
  health: PluginHealth,
  clientProbes: Record<CapabilityId, boolean>,
  now: number,
): CapabilityStatus {
  if (plugin.runtime === 'client') {
    return clientProbes[capability] ? 'available' : 'degraded'
  }

  const entry = health.plugins[plugin.id]
  // Nobody writes "offline" when the Stage-Server dies, so a stale heartbeat - or none
  // at all - is the only signal the tablets get. It has to count as offline.
  if (!entry || entry.status !== 'online') return 'degraded'
  if (now - entry.lastSeenAt > HEALTH_TIMEOUT_MS) return 'degraded'
  return 'available'
}

/** Status of a whole widget: the weakest of everything it requires. */
export function capabilityStatusFor(
  requires: CapabilityId[],
  statuses: Map<CapabilityId, CapabilityStatus>,
): CapabilityStatus {
  let worst: CapabilityStatus = 'available'
  for (const capability of requires) {
    const status = statuses.get(capability) ?? 'missing'
    if (status === 'missing') return 'missing'
    if (status === 'degraded') worst = 'degraded'
  }
  return worst
}
