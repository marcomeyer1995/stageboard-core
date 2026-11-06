import { DEFAULT_PLAY_LEAD_MS, PLAY_LEAD_LIMITS, type Device, type DeviceInfo } from 'shared-types'

/**
 * The Play lead (Marco, 2026-11-06): how far after Play the first sound of a fresh song lies - the
 * band's setting in Bühne, DEFAULT_PLAY_LEAD_MS without one. Long enough for the Play to reach every
 * device and for the slowest output to schedule it: with the native output a device hears its
 * audio its whole delay after scheduling it (Fire 483 ms); with 400 ms its first click and
 * announcement came 100-300 ms late.
 */
let lead = DEFAULT_PLAY_LEAD_MS

/** From the band settings (useBandSettingsStore) - out-of-range values are clamped. */
export function setPlayLead(ms: number | undefined): void {
  lead = ms === undefined ? DEFAULT_PLAY_LEAD_MS : Math.min(PLAY_LEAD_LIMITS.max, Math.max(PLAY_LEAD_LIMITS.min, Math.round(ms)))
}

export function playLeadMs(): number {
  return lead
}

/**
 * Where a fresh song start begins, in song time: the first sound (the count-in's first click at
 * `countInStartMs` <= 0, else song time 0) lies the lead after Play. Before 2026-11-06 the lead went
 * before song time 0 only - with a count-in longer than the lead its first click was due the moment
 * Play was pressed, and came late on every device.
 */
export function freshStartMs(countInStartMs: number, leadMs: number = playLeadMs()): number {
  return Math.min(0, countInStartMs) - leadMs
}

/** Scheduling needs this much on top: the schedulers' tick (50 ms) and some room for a busy frame. */
export const LEAD_RESERVE_MS = 100

/**
 * The lead this device needed for a fresh Play: how long the Play took to reach it, plus how late
 * its output plays what it schedules, plus the reserve. Null when it can't be told (no Play time).
 */
export function leadNeeded(playStartedAt: number, seenAt: number, outputDelayMs: number): number {
  return Math.round(Math.max(0, seenAt - playStartedAt) + outputDelayMs + LEAD_RESERVE_MS)
}

/** Rounded up to the setting's step - the value to suggest for a device that needed `ms`. */
export function suggestedLead(ms: number): number {
  return Math.min(PLAY_LEAD_LIMITS.max, Math.ceil(ms / PLAY_LEAD_LIMITS.step) * PLAY_LEAD_LIMITS.step)
}

/** Every device that reported what it needed at its last Play (leadCheck.ts), most first. */
export function leadReports(info: DeviceInfo, devices: readonly Device[]): { id: string; name: string; neededMs: number }[] {
  return Object.entries(info.devices)
    .filter(([, entry]) => typeof entry.leadNeededMs === 'number')
    .map(([id, entry]) => ({ id, name: devices.find((device) => device.id === id)?.name ?? entry.os, neededMs: entry.leadNeededMs as number }))
    .sort((a, b) => b.neededMs - a.neededMs)
}
