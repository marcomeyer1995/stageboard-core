import { AUDIO_OUTPUT, NATIVE_AUDIO_OUTPUT, SERVER_EXECUTION_TARGET, type AudioRoute, type LatencyProfileDoc, type LogicalDevice } from 'shared-types'

/** ● measured by a sensor, ◐ set by hand (or a plugin's default), ○ no value yet (docs/31 §5). */
export type StagePathState = 'measured' | 'manual' | 'missing'

/**
 * One physical path of the stage (docs/31): an output of a device to where it is heard - with
 * exactly one latency correction (Marco, 2026-11-05) and who uses it.
 */
export interface StagePath {
  key: string
  /** `audio`: the device's own sound (click, track, announcements) over a route; `output`: a
   * Logical Device it drives (Kemper, lights, MIDI clock …). */
  kind: 'audio' | 'output'
  /** The latency profile's `output` this path's value lives in (for audio: the native output's,
   * if the device has one, else the WebView's). */
  output: string
  route: AudioRoute | null
  /** The output's name (a Logical Device) - audio paths are named by their route. */
  name: string | null
  latencyMs: number | null
  state: StagePathState
  /** What runs on it (role names) and who hears it at this device. */
  roles: string[]
  person: string | null
}

export interface StageDevicePaths {
  deviceId: string
  name: string
  own: boolean
  paths: StagePath[]
}

export interface StagePathsInput {
  devices: readonly { id: string; name: string; lastSeenAt?: number }[]
  /** Now (ms) - a device without a role not seen for STALE_DAYS is left out. */
  now?: number
  ownDeviceId: string
  logicalDevices: readonly LogicalDevice[]
  profiles: readonly LatencyProfileDoc[]
  /** The capabilities whose sound plays on the device itself, and their names. */
  builtIn: ReadonlyMap<string, string>
  /** Who is signed in on a device (name), or null. */
  personAt: (deviceId: string) => string | null
  serverName: string
}

function stateOf(profile: LatencyProfileDoc | undefined): StagePathState {
  if (!profile) return 'missing'
  return profile.source === 'measured' ? 'measured' : 'manual'
}

/** A device that plays nothing and hasn't been around for this long is left out - an old tablet
 * with nothing but a stored value cluttered the list (2026-11-05). */
const STALE_MS = 14 * 24 * 60 * 60 * 1000

/**
 * The paths of the band's stage, grouped by device - this device first (docs/31 §4). A device
 * shows up when it is this one, plays a role, or has a stored value. Audio paths come from the
 * stored values per route; a device that plays click/track/announcements without any gets one
 * missing "speaker" path, so it isn't forgotten.
 */
export function stagePaths(input: StagePathsInput): StageDevicePaths[] {
  const { devices, ownDeviceId, logicalDevices, profiles, builtIn, personAt, serverName, now = Date.now() } = input
  const all = [...devices.map((d) => ({ id: d.id, name: d.name, lastSeenAt: d.lastSeenAt })), { id: SERVER_EXECUTION_TARGET, name: serverName, lastSeenAt: undefined }]
  const result: StageDevicePaths[] = []
  for (const device of all) {
    const roles = logicalDevices.filter((role) => role.executionTarget === device.id)
    if (device.id !== ownDeviceId && roles.length === 0 && device.lastSeenAt !== undefined && now - device.lastSeenAt > STALE_MS) continue
    const soundRoles = roles.filter((role) => builtIn.has(role.capability)).map((role) => builtIn.get(role.capability)!)
    const ownProfiles = profiles.filter((p) => p.deviceId === device.id)
    const paths: StagePath[] = []

    if (device.id !== SERVER_EXECUTION_TARGET) {
      const audio = ownProfiles.filter((p) => p.output === AUDIO_OUTPUT || p.output === NATIVE_AUDIO_OUTPUT)
      const routes = [...new Set(audio.map((p) => p.route).filter((r): r is AudioRoute => r !== null))]
      if (routes.length === 0 && soundRoles.length > 0) routes.push('speaker')
      for (const route of routes) {
        const native = audio.find((p) => p.output === NATIVE_AUDIO_OUTPUT && p.route === route)
        const web = audio.find((p) => p.output === AUDIO_OUTPUT && p.route === route)
        const profile = native ?? web
        paths.push({
          key: `${device.id}:audio:${route}`,
          kind: 'audio',
          output: profile?.output ?? AUDIO_OUTPUT,
          route,
          name: null,
          latencyMs: profile?.latencyMs ?? null,
          state: stateOf(profile),
          roles: [...new Set(soundRoles)],
          person: personAt(device.id),
        })
      }
    }

    for (const role of roles.filter((r) => !builtIn.has(r.capability))) {
      const profile = ownProfiles.find((p) => p.output === role.id)
      paths.push({
        key: `${device.id}:output:${role.id}`,
        kind: 'output',
        output: role.id,
        route: null,
        name: role.name,
        latencyMs: profile?.latencyMs ?? null,
        state: stateOf(profile),
        // The path is named after it already - only who uses it.
        roles: [],
        person: device.id === SERVER_EXECUTION_TARGET ? null : personAt(device.id),
      })
    }

    const own = device.id === ownDeviceId
    if (own || paths.length > 0) result.push({ deviceId: device.id, name: device.name, own, paths })
  }
  return result.sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name))
}
