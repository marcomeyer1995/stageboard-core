import { AUDIO_OUTPUT, type AudioRoute, type LatencyProfileDoc } from 'shared-types'

/** The stored profile for one output path, or null. Audio is per route; an unknown route (a browser)
 * only matches a profile stored for `unknown`. */
export function findLatencyProfile(
  profiles: readonly LatencyProfileDoc[],
  deviceId: string,
  output: string,
  route: AudioRoute | null,
): LatencyProfileDoc | null {
  return profiles.find((p) => p.deviceId === deviceId && p.output === output && p.route === route) ?? null
}

/** German labels for the audio routes (Geräte tab, settings). */
export const ROUTE_LABEL: Record<AudioRoute, string> = {
  speaker: 'Lautsprecher',
  wired: 'Kopfhörer (Kabel)',
  bluetooth: 'Bluetooth',
  usb: 'USB-Audio',
  unknown: 'unbekannt (Browser)',
}

/** How much earlier this device schedules its own audio (click, backing track): the stored value for
 * its current route, 0 without one or with compensation switched off. Never negative - audio can't
 * be played later than scheduled by asking for it earlier. */
export function audioOutputLatencyMs(profiles: readonly LatencyProfileDoc[], deviceId: string, route: AudioRoute, on: boolean): number {
  if (!on) return 0
  return Math.max(0, findLatencyProfile(profiles, deviceId, AUDIO_OUTPUT, route)?.latencyMs ?? 0)
}
