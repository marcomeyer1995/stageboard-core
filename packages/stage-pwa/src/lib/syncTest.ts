import { createAudioClock } from './audioClock'
import { playClickAt } from './clickEngine'
import { getServerTime } from './clockSync'
import { getSharedAudioContext } from './sharedAudioContext'
import { getMidiOutputById } from './webMidiOutput'

/**
 * Sync test (docs/21 §4, #477/#302): every device runs it at once and marks each full second of
 * server time - a MIDI note on its chosen output (note number = the second mod 128, so a receiver
 * can match the same second across devices) and, optionally, the real click sound through the same
 * audio path as the Gig click (same clock smoothing, same tone). A laptop that is the Stage-Server
 * logs the arrivals against its own clock: the offset of each device from server time, the offset
 * between devices, and - from a microphone - each device's audio output latency
 * (scripts/midi-timing-probe/sync-receiver.py).
 */
export interface SyncTestOptions {
  /** MIDI output to mark the seconds on; null = click only. */
  outputId: string | null
  /** 0-indexed MIDI channel - one per device, so the receiver tells devices apart. */
  channel: number
  click: boolean
  durationS: number
  /** Schedule the click earlier by this device's stored output latency (#491) - to check the
   * compensation: the click then lands on the server second. 0 (default) = the raw latency, what a
   * calibration measures. */
  clickLatencyMs?: number
}

export interface SyncTestStatus {
  running: boolean
  marked: number
  endsAt: number | null
}

const SCHEDULE_AHEAD_MS = 500
const TICK_MS = 100

let status: SyncTestStatus = { running: false, marked: 0, endsAt: null }
let stopCurrent: (() => void) | null = null

export function getSyncTestStatus(): SyncTestStatus {
  return status
}

/** The full seconds of server time in (after, until], at least `minLeadMs` ahead of `now`. */
export function secondsToMark(after: number, until: number, now: number, minLeadMs = 20): number[] {
  const out: number[] = []
  for (let t = Math.floor(after / 1000) * 1000 + 1000; t <= until; t += 1000) if (t >= now + minLeadMs) out.push(t)
  return out
}

export async function startSyncTest(options: SyncTestOptions): Promise<void> {
  stopSyncTest()
  const output = options.outputId ? await getMidiOutputById(options.outputId) : null
  const ctx = options.click ? getSharedAudioContext() : null
  if (ctx) await ctx.resume()
  const clock = createAudioClock()
  const endsAt = getServerTime() + options.durationS * 1000
  let lastMarked = getServerTime()
  status = { running: true, marked: 0, endsAt }

  const tick = () => {
    const now = getServerTime()
    const until = Math.min(now + SCHEDULE_AHEAD_MS + (options.clickLatencyMs ?? 0), endsAt)
    const audioNow = ctx ? clock.now(ctx) : 0
    for (const second of secondsToMark(lastMarked, until, now)) {
      const inMs = second - now
      if (output) {
        const at = performance.now() + inMs
        const note = (second / 1000) % 128
        output.send([0x90 | (options.channel & 0x0f), note, 100], at)
        output.send([0x80 | (options.channel & 0x0f), note, 0], at + 50)
      }
      if (ctx) playClickAt(ctx, audioNow + (inMs - (options.clickLatencyMs ?? 0)) / 1000, true)
      lastMarked = second
      status = { ...status, marked: status.marked + 1 }
    }
    if (now >= endsAt) stopSyncTest()
  }
  tick()
  const timer = setInterval(tick, TICK_MS)
  stopCurrent = () => clearInterval(timer)
}

export function stopSyncTest(): void {
  stopCurrent?.()
  stopCurrent = null
  status = { ...status, running: false, endsAt: null }
}
