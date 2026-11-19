import { JOB_IDS, unavailableJobs } from 'sync-host'
import type { HostCapabilities } from 'shared-types'

/**
 * What a tablet host can do (#962, step 3): its power alone decides. It holds bands, syncs, relays and serves audio -
 * everything of the shared host module - but runs no Node: every job that needs one is refused with the reason, and a
 * phone sends it to a host that can. The heavy plugins of the build are listed with what they need, so the app shows
 * them as "not on this device" instead of hiding them.
 */
const DESKTOP_ONLY = 'a desktop machine (Windows, macOS or Linux)'
const HEAVY_PLUGINS = ['stem-separation', 'piper-speech', 'ultimate-guitar-import', 'youtube-download']

export function createTabletCapabilities(device: { platform: string; arch?: string; cpuCores?: number; memoryMb?: number }): HostCapabilities {
  return {
    kind: 'android',
    platform: device.platform,
    arch: device.arch ?? 'unknown',
    database: 'builtin',
    ...(device.cpuCores && device.cpuCores > 0 ? { cpuCores: Math.floor(device.cpuCores) } : {}),
    ...(device.memoryMb && device.memoryMb > 0 ? { memoryMb: Math.floor(device.memoryMb) } : {}),
    jobs: unavailableJobs(DESKTOP_ONLY, JOB_IDS),
    plugins: HEAVY_PLUGINS.map((id) => ({ id, available: false, needs: DESKTOP_ONLY })),
  }
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
