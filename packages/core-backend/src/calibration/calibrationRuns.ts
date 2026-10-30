import { randomUUID } from 'node:crypto'
import type { CalibrationRunStatus, MeasureInputKind } from 'shared-types'
import { matchLatency } from './matchLatency.js'
import { startMicCapture, type MicCapture } from './micCapture.js'
import { irregularSchedule } from './schedule.js'

/** How long before the first click a run starts - the device must learn the times and schedule them. */
const START_LEAD_MS = 1500
/** Recording continues this long after the last planned click - the longest latency we accept. */
export const MAX_LATENCY_MS = 2000

export type CalibrationRunState = CalibrationRunStatus

interface Run {
  id: string
  times: number[]
  status: CalibrationRunState
}

/**
 * Latency calibration with the Stage-Server's microphone as the sensor (docs/21 §4, #491): a device
 * asks for a run, gets an irregular list of click times (server time), plays its real click at those
 * times; the server records meanwhile and finds the delay at which the heard pattern fits the
 * planned one. One run at a time - two devices clicking together would mix their patterns.
 */
export class CalibrationRuns {
  private current: Run | null = null
  private readonly finished = new Map<string, Run>()

  constructor(
    private readonly capture: (input: MeasureInputKind) => MicCapture = () => startMicCapture(),
    private readonly now: () => number = () => Date.now(),
    private readonly schedule: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms),
  ) {}

  /** Starts a run of `count` clicks, recorded on the microphone or the cable input (#662); null
   * while another run is still recording. */
  start(count = 12, input: MeasureInputKind = 'mic'): { id: string; times: number[]; recordUntil: number } | null {
    if (this.current) return null
    const times = irregularSchedule(this.now() + START_LEAD_MS, count)
    const recordUntil = times[times.length - 1]! + MAX_LATENCY_MS
    const run: Run = { id: randomUUID(), times, status: { state: 'recording', recordUntil } }
    this.current = run
    const mic = this.capture(input)
    this.schedule(() => this.finish(run, mic), recordUntil - this.now())
    return { id: run.id, times, recordUntil }
  }

  /** Whether a run is recording right now (the input is in use). */
  busy(): boolean {
    return this.current !== null
  }

  get(id: string): CalibrationRunState | null {
    if (this.current?.id === id) return this.current.status
    return this.finished.get(id)?.status ?? null
  }

  private finish(run: Run, mic: MicCapture): void {
    mic.stop()
    const error = mic.error()
    const onsets = mic.onsetsMs()
    run.status = error ? { state: 'failed', error } : { state: 'done', result: matchLatency(run.times, onsets, { maxMs: MAX_LATENCY_MS }), onsets: onsets.length }
    this.current = null
    this.finished.set(run.id, run)
    // Keep only the last few results.
    while (this.finished.size > 10) this.finished.delete(this.finished.keys().next().value!)
  }
}
