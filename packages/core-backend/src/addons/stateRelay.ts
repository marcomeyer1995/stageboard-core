import { DeviceStateEventSchema, type StateField } from 'shared-types'
import type { HostChannels } from 'sync-host'

/**
 * What an add-on's device published (`notify` topic `state`, docs/36 §5a) becomes a value of the band's device state - **or is refused with its reason**.
 * The add-on says `{device, key, value}`; StageBoard stamps the time, and the channel checks the key and the value against the fields the add-on
 * declared in its manifest. Nothing the add-on says goes further unchecked.
 */
export function relayAddonState(options: {
  channels: Pick<HostChannels, 'publishDeviceState'>
  /** The band this host serves; none: there is nobody to tell. */
  workspaceId: string | null
  addonId: string
  body: unknown
  declared: Readonly<Record<string, StateField>>
  now?: () => number
  log?: { error: (msg: string, meta?: Record<string, unknown>) => void }
}): boolean {
  const { workspaceId, addonId, log } = options
  if (!workspaceId) return false
  const said = typeof options.body === 'object' && options.body !== null ? (options.body as Record<string, unknown>) : {}
  const parsed = DeviceStateEventSchema.safeParse({ device: said.device, key: said.key, value: said.value, at: (options.now ?? Date.now)() })
  if (!parsed.success) {
    log?.error(`add-on ${addonId}: a state message is not {device, key, value}`, { issue: parsed.error.issues[0]?.message })
    return false
  }
  const result = options.channels.publishDeviceState(workspaceId, parsed.data, options.declared)
  if (!result.ok) log?.error(`add-on ${addonId}: state refused`, { device: parsed.data.device, reason: result.reason })
  return result.ok
}
