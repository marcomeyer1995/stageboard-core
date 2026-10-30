import i18n from '../i18n'
import { useEffect, useRef } from 'react'
import type { ShowLogEvent } from 'shared-types'
import { measureInputFor, runAudioCalibration } from './audioCalibration'
import { getServerTime } from './clockSync'
import { getDeviceId } from './deviceId'
import { audioOutputLatencyMs } from './latencyProfiles'
import { useAudioRouteStore } from '../store/useAudioRouteStore'
import { useLatencyProfilesStore } from '../store/useLatencyProfilesStore'
import { useShowLogStore } from '../store/useShowLogStore'
import { useShowStateStore } from '../store/useShowStateStore'

type RigCheckRun = Extract<ShowLogEvent, { type: 'rig-check-run' }>
type RigCheckDeviceReport = Extract<ShowLogEvent, { type: 'rig-check-device' }>
export type MeasuredClick = NonNullable<RigCheckDeviceReport['measured']>

/**
 * The measuring round before the run (docs/24 §7.1, #662): after "Vorbereiten" the master gives
 * every device of the run a slot; one after the other, each plays 12 clicks with its stored latency
 * while the Stage-Server listens on the input for its current route. Fixed slots instead of a
 * hand-over: a device that is off or busy simply misses its slot and stands as "nicht gemessen",
 * the round goes on.
 */

/** One device's measurement: 1.5 s lead, ~12 s of clicks, 2 s listening after (calibrationRuns.ts),
 * plus room for a late start and the analysis. */
export const MEASURE_SLOT_MS = 18_000
/** Time the devices get to learn about the round before the first slot. */
const MEASURE_LEAD_MS = 1500
/** How long a device keeps asking when the server is still busy with the slot before. */
const RETRY_FOR_MS = 3000

/** Limits of a good result (docs/24 §7.1, Marco 2026-10-29). */
export const OFFSET_LIMIT_MS = 15
export const JITTER_LIMIT_MS = 5

/** When the round is over: the last slot's end. */
export function measureRoundEnd(run: RigCheckRun): number | null {
  const slots = run.measure?.slots ?? []
  return slots.length ? slots[slots.length - 1]!.at + MEASURE_SLOT_MS : null
}

/** Whether the round is going on right now. */
export function measureRoundRunning(run: RigCheckRun, now: number): boolean {
  const end = measureRoundEnd(run)
  return end !== null && now < end
}

/** The slot being measured now, with its place in the round. */
export function currentSlot(run: RigCheckRun, now: number): { deviceName: string; index: number; count: number } | null {
  const slots = run.measure?.slots ?? []
  const index = slots.findIndex((slot) => now >= slot.at && now < slot.at + MEASURE_SLOT_MS)
  return index < 0 ? null : { deviceName: slots[index]!.deviceName, index, count: slots.length }
}

/** Green when the click came within ±15 ms, varied by at most ±5 ms and all clicks were heard. */
export function measuredVerdict(measured: MeasuredClick | undefined): 'ok' | 'problem' | null {
  if (!measured) return null
  if (measured.error || measured.offsetMs === null || !measured.reliable) return 'problem'
  const allHeard = measured.matched >= measured.total
  return Math.abs(measured.offsetMs) <= OFFSET_LIMIT_MS && (measured.jitterMs ?? 0) <= JITTER_LIMIT_MS && allHeard ? 'ok' : 'problem'
}

/** The note a red measurement pre-fills in "Alles in Ordnung?" (docs/24 §7.3) - the musician can
 * change it, the verdict stays theirs. */
export function measuredNote(measured: MeasuredClick): string {
  if (measured.error) return i18n.t('rigcheck:verdict.measuredFailed', { message: measured.error })
  if (measured.offsetMs === null || !measured.reliable || measured.matched < measured.total)
    return i18n.t('rigcheck:verdict.measuredMissing', { matched: measured.matched, total: measured.total })
  if (Math.abs(measured.offsetMs) > OFFSET_LIMIT_MS)
    return i18n.t(measured.offsetMs > 0 ? 'rigcheck:verdict.measuredLate' : 'rigcheck:verdict.measuredEarly', { ms: Math.round(Math.abs(measured.offsetMs)) })
  return i18n.t('rigcheck:verdict.measuredJitter', { ms: Math.round(measured.jitterMs ?? 0) })
}

/** The latency the device should have for that route: what it played with plus what was still
 * off - null when the measurement gives no clear value. */
export function correctedLatencyMs(measured: MeasuredClick): number | null {
  if (measured.error || measured.offsetMs === null || !measured.reliable) return null
  return Math.round(measured.storedMs + measured.offsetMs)
}

/**
 * Starts the round (master): every device that reports in the run and follows it (Gig, not Solo
 * Üben) gets a slot, in name order. Returns how many.
 */
export async function startMeasureRound(run: RigCheckRun, reports: readonly RigCheckDeviceReport[]): Promise<number> {
  if (!useShowStateStore.getState().isMaster || run.startedAt !== undefined) return 0
  const now = Math.round(getServerTime())
  const devices = reports.filter((report) => report.mode === 'gig')
  const slots = devices.map((report, i) => ({ deviceId: report.deviceId, deviceName: report.deviceName, at: now + MEASURE_LEAD_MS + i * MEASURE_SLOT_MS }))
  if (slots.length === 0) return 0
  await useShowLogStore.getState().append({ ...run, measure: { startedAt: now, slots } })
  return slots.length
}

/** This device's measurement in its slot - the calibration "Prüfen" does by hand (#498). */
async function measureOwnClick(slotAt: number): Promise<MeasuredClick> {
  const deviceId = getDeviceId()
  const route = useAudioRouteStore.getState().route
  const storedMs = audioOutputLatencyMs(useLatencyProfilesStore.getState().profiles, deviceId, route, true)
  const input = measureInputFor(route)
  let outcome = await runAudioCalibration(storedMs)
  // The slot before may still be finishing on the server (a late start there) - ask again briefly.
  while (!outcome.ok && outcome.busy && getServerTime() < slotAt + RETRY_FOR_MS) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    outcome = await runAudioCalibration(storedMs)
  }
  const base = { at: Math.round(getServerTime()), input, audioRoute: route, storedMs }
  if (!outcome.ok) return { ...base, offsetMs: null, jitterMs: null, matched: 0, total: 12, reliable: false, error: outcome.message.slice(0, 300) }
  if (outcome.status.state === 'failed') return { ...base, offsetMs: null, jitterMs: null, matched: 0, total: 12, reliable: false, error: outcome.status.error.slice(0, 300) }
  if (outcome.status.state !== 'done' || !outcome.status.result) return { ...base, offsetMs: null, jitterMs: null, matched: 0, total: 12, reliable: false }
  const match = outcome.status.result
  return {
    ...base,
    offsetMs: Math.round(match.latencyMs * 10) / 10,
    jitterMs: Math.round(match.jitterMs * 10) / 10,
    matched: match.matched,
    total: match.total,
    reliable: match.reliable,
  }
}

/**
 * Every device, while a run is open: measures itself when its slot comes and puts the result into
 * its report. Mounted once in App.tsx, beside the reporter.
 */
export function useRigCheckMeasurer(): void {
  const measuredFor = useRef<string | null>(null)
  useEffect(() => {
    const tick = () => {
      const now = getServerTime()
      const events = useShowLogStore.getState().events
      // Inline instead of openRun (rigCheck.ts imports this module).
      let run: RigCheckRun | null = null
      for (const e of events) if (e.type === 'rig-check-run' && (!run || e.at > run.at)) run = e
      if (!run?.measure || run.endedAt !== undefined || run.startedAt !== undefined) return
      const slot = run.measure.slots.find((s) => s.deviceId === getDeviceId())
      const key = `${run.showId}-${run.measure.startedAt}`
      if (!slot || measuredFor.current === key || now < slot.at || now > slot.at + MEASURE_SLOT_MS) return
      measuredFor.current = key
      const current = run
      void measureOwnClick(slot.at)
        .then(async (measured) => {
          const { writeOwnReport, hasRunTrack } = await import('./rigCheck')
          await writeOwnReport(current, await hasRunTrack(current), undefined, measured)
        })
        .catch((err) => console.error('Rig-Check: measuring failed', err))
    }
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [])
}
