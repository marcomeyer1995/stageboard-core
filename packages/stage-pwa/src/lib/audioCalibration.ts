import i18n from '../i18n'
import type { AudioRoute, CalibrationRunStart, CalibrationRunStatus, MeasureInputKind } from 'shared-types'
import { createAudioClock } from './audioClock'
import { playClickAt } from './clickEngine'
import { getServerTime } from './clockSync'
import { getDeviceId } from './deviceId'
import { getSharedAudioContext, holdAudioOutputAwake } from './sharedAudioContext'
import { getStageServerUrl } from './stageServer'
import { useAudioRouteStore } from '../store/useAudioRouteStore'

const AHEAD_MS = 500
const TICK_MS = 50

/** Which measuring input hears this route (#662): the speaker through the air - also when the
 * route is unknown (a browser) - everything plugged in or paired through the cable. */
export function measureInputFor(route: AudioRoute): MeasureInputKind {
  return route === 'speaker' || route === 'unknown' ? 'mic' : 'cable'
}

export type AudioCalibrationOutcome = { ok: true; status: CalibrationRunStatus } | { ok: false; message: string }

/**
 * Measures this device's audio output latency with the Stage-Server's microphone (docs/21 §4,
 * #491): the server hands out an irregular list of click times and records; this device plays the
 * real click (same tone and clock mapping as the Gig click) at those times; the server reports the
 * delay at which what it heard fits the pattern. `earlierByMs` > 0 plays the clicks that much
 * earlier - the check of a stored value ("Prüfen"), which should then come out near 0.
 */
export async function runAudioCalibration(earlierByMs = 0, onProgress?: (msLeft: number) => void): Promise<AudioCalibrationOutcome> {
  const base = getStageServerUrl()
  if (!base) return { ok: false, message: i18n.t('messages:noServer') }
  let run: CalibrationRunStart
  try {
    const response = await fetch(`${base}/calibration/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), input: measureInputFor(useAudioRouteStore.getState().route) }),
    })
    if (!response.ok) return { ok: false, message: ((await response.json().catch(() => ({}))) as { message?: string }).message ?? `HTTP ${response.status}` }
    run = (await response.json()) as CalibrationRunStart
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }

  const ctx = getSharedAudioContext()
  await ctx.resume().catch(() => {})
  // A Bluetooth output asleep would swallow the first clicks (sharedAudioContext.ts, #468).
  holdAudioOutputAwake('calibration', true)
  const clock = createAudioClock()
  let next = 0
  await new Promise<void>((resolve) => {
    const tick = () => {
      const now = getServerTime()
      const audioNow = clock.now(ctx)
      while (next < run.times.length && run.times[next]! - earlierByMs <= now + AHEAD_MS) {
        playClickAt(ctx, audioNow + (run.times[next]! - earlierByMs - now) / 1000, true)
        next++
      }
      onProgress?.(Math.max(0, run.recordUntil - now))
      if (now >= run.recordUntil) {
        clearInterval(timer)
        resolve()
      }
    }
    const timer = setInterval(tick, TICK_MS)
    tick()
  })
  holdAudioOutputAwake('calibration', false)

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch(`${base}/calibration/runs/${run.id}`)
      const status = (await response.json()) as CalibrationRunStatus
      if (status.state !== 'recording') return { ok: true, status }
    } catch {
      // Retry - the server finishes the analysis right after recording.
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return { ok: false, message: i18n.t('messages:noResult') }
}
