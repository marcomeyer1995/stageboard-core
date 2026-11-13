import type { BatteryState } from 'shared-types'

interface BatteryManagerLike {
  level: number
  charging: boolean
}

/**
 * This device's battery (#747, the map's check) - null where the platform does not tell (iOS,
 * Firefox). A computer without a battery reports 100 % and charging, which reads right.
 */
export async function batteryState(): Promise<BatteryState | null> {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> }) : undefined
  if (typeof nav?.getBattery !== 'function') return null
  try {
    const battery = await nav.getBattery()
    if (!Number.isFinite(battery.level)) return null
    return { pct: Math.round(Math.min(1, Math.max(0, battery.level)) * 100), charging: battery.charging }
  } catch {
    return null
  }
}
