import { createJobRunners, JOB_IDS, type JobRunner } from 'sync-host'
import type { HostCapabilities } from 'shared-types'

/**
 * What a tablet host can do (#962, step 3/4). Only the power of the device decides, and **everything that is technically
 * feasible is allowed** (Marco, 2026-11-19): a tablet is not refused for being a tablet. What it does today is everything of
 * the shared host module - bands, sync, live channels, audio, accounts. What it does not do *yet* is said as that
 * ("not built for Android yet", feasible), never as "impossible", and each entry says in plain words why it would be slow and
 * how to improve it - so the person can decide to wait (overnight, charging) or to send the job to a stronger device.
 */
const NOT_BUILT = 'an Android version of it (not built yet)'

const SLOW_HEAVY =
  'A tablet works on this with a much weaker processor and far less memory than a laptop, so it takes much longer and the tablet gets hot and drains its battery. It can run overnight while charging. To make it faster: do it on a laptop (more cores, or a graphics card) or a newer, stronger tablet.'

const NOTES: Record<string, string> = {
  'stem-separation': SLOW_HEAVY,
  speech: SLOW_HEAVY,
  'piper-speech': SLOW_HEAVY,
  'youtube-download': 'A tablet downloads YouTube itself with the add-on\'s Android helper (a separate app the band installs once); it does not yet do it for other devices. That works today on the tablet you hold.',
  'osc-in': 'Needs a network port the app can listen on; Android allows it, it is not built yet. Until then, send OSC to a laptop host.',
  backup: 'Copying the band to a drive needs the folder access Android asks for; feasible, not built yet. Until then, back up on a laptop host.',
}

const HEAVY_PLUGINS = ['stem-separation', 'piper-speech', 'ultimate-guitar-import', 'youtube-download']

export function createTabletCapabilities(device: { platform: string; arch?: string; cpuCores?: number; memoryMb?: number }): HostCapabilities {
  // The same registry a Node host answers from (sync-host/jobRunners.ts, #964); what a tablet registers is runners that say "not built yet"
  // with the note the person reads - each one is replaced by a real runner when the job exists on Android.
  const unbuilt = (id: string, kind: 'job' | 'plugin'): JobRunner => ({ id, kind, missing: () => NOT_BUILT, ...(NOTES[id] ? { note: NOTES[id] } : {}) })
  const runners = createJobRunners([...JOB_IDS.map((id) => unbuilt(id, 'job')), ...HEAVY_PLUGINS.map((id) => unbuilt(id, 'plugin'))])
  return runners.capabilities(
    { kind: 'android', platform: device.platform, arch: device.arch ?? 'unknown', ...(device.cpuCores && device.cpuCores > 0 ? { cpuCores: Math.floor(device.cpuCores) } : {}), ...(device.memoryMb && device.memoryMb > 0 ? { memoryMb: Math.floor(device.memoryMb) } : {}) },
    { plugins: HEAVY_PLUGINS, notBuilt: NOT_BUILT },
  )
}

/** The device as the browser tells it - best effort: absent values stay out of the answer rather than being invented. */
export function deviceFromBrowser(): { platform: string; cpuCores?: number; memoryMb?: number } {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number })
  return {
    platform: 'android',
    ...(nav?.hardwareConcurrency ? { cpuCores: nav.hardwareConcurrency } : {}),
    // `deviceMemory` is in GB and capped by the browser (a coarse hint, not a measurement).
    ...(nav?.deviceMemory ? { memoryMb: Math.round(nav.deviceMemory * 1024) } : {}),
  }
}
