/**
 * Where a capability's triggers actually go, given the current `ShowState.deviceClaims` entry
 * for it (#10, generalized beyond audio - see showState.ts's doc comment on `deviceClaims`).
 * Deliberately mode-agnostic: Practice mode's "always play locally regardless of any claim" is
 * audio-specific (Practice has no lighting/mixer equivalent at all), so callers that care about
 * Practice mode override the result themselves rather than this function taking a mode param.
 */
export type DeviceClaimEngine = 'plugin' | 'local-mine' | 'local-other' | 'none'

export function resolveDeviceClaimEngine(
  claimedDeviceId: string | undefined,
  deviceId: string,
  pluginId: string | null,
): DeviceClaimEngine {
  if (claimedDeviceId === undefined) return pluginId ? 'plugin' : 'none'
  return claimedDeviceId === deviceId ? 'local-mine' : 'local-other'
}
