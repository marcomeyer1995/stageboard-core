import { registerPlugin } from '@capacitor/core'
import type { AudioOutputHealth, DeviceVitalsSummary, VitalsIssue } from 'shared-types'
import { create } from 'zustand'
import { useClockSyncStore } from '../store/useClockSyncStore'
import { isNativeApp } from './native'
import { nativeOutputHealth } from './nativeOutput'
import { peekSharedAudioContext } from './sharedAudioContext'

/**
 * This device's condition (Marco, 2026-11-06): the phone played with 20 % of its audio missing
 * after 17 h - its WebView rendered audio up to 0.6 % slower than real time, 250 MB of memory free
 * - and nothing on screen said so. Watches what can be watched from inside the app: the audio
 * clock against real time, long frames, memory and the app process's CPU (DeviceVitalsPlugin.java;
 * device-wide CPU is closed to apps since Android 8, the WebView's own process too), the band
 * clock. Diagnose shows all of it, the Geräte tab the traffic light (summarizeVitals).
 */

interface NativeVitals {
  availMb: number
  totalMb: number
  thresholdMb: number
  lowMemory: boolean
  appMb: number
  cpuMs: number
  uptimeMs: number
  cores: number
}

interface DeviceVitalsPlugin {
  read(): Promise<NativeVitals>
}

const DeviceVitals = registerPlugin<DeviceVitalsPlugin>('DeviceVitals')

/** The audio clock is read this often while its context runs. */
const CLOCK_SAMPLE_MS = 250
/** Its speed is fitted over this long. */
const CLOCK_WINDOW_MS = 30_000
/** Lost time over this much from one second to the next counts as a stall of the audio thread
 * (the Fire renders in blocks of up to 160 ms, so its clock steps - the lowest lag of each second
 * stays flat while nothing is lost). */
const CLOCK_LOSS_MS = 50
/** A second needs this many reads to count (see audioClockVitals). */
const MIN_READS_PER_SECOND = 2
/** Seconds compared before and after a possible loss. */
const LOSS_SPAN_S = 3
/** The native output follows 0.25 % (its time line); more and its reserve runs empty. */
const CLOCK_WARN_PCT = 0.25
/** Frames this long count as the app standing still. */
export const STALL_MS = 200
/** A rotation (or any window size change) lays the whole app out anew - 200-300 ms on a tablet,
 * expected and not a hang (2026-11-06: "App hängt" after every rotation). Frames this soon after
 * one don't count. */
export const RELAYOUT_GRACE_MS = 2000
const NATIVE_READ_MS = 10_000
const MINUTE_MS = 60_000
/** Reserve below this is close to dropouts (nativeOutput.ts TIGHT_LEAD_MS). */
const TIGHT_LEAD_MS = 30
/** The band clock is unsure past this uncertainty, or when its last sample is this old. */
const CLOCK_UNSURE_MS = 5
/** The band clock holds its estimate between samples (it drifts ~0.3 ms a minute); while songs
 * download, slow samples are rejected for a while (#698) - only this long without one is unsure. */
const CLOCK_STALE_MS = 120_000

export interface AudioClockVitals {
  /** How far the audio clock runs from real time, % (negative = slower). Null until 10 s are in. */
  pct: number | null
  /** Stalls of the audio thread in the last minute (time lost, not caught up), and the longest. */
  losses: number
  worstLossMs: number
}

export interface VitalsSnapshot {
  at: number
  audio: AudioOutputHealth | null
  audioClock: AudioClockVitals | null
  native: (NativeVitals & { cpuPct: number | null }) | null
  /** JavaScript memory of the page, MB (Chrome/WebView only). */
  jsHeapMb: number | null
  jsHeapLimitMb: number | null
  /** Frames of STALL_MS and more in the last minute, and the longest frame of the last minute. */
  stallsPerMin: number
  worstFrameMs: number
  /** Whether this browser reports long frames at all. */
  framesWatched: boolean
  uptimeMs: number
  clock: { offsetMs: number; uncertaintyMs: number | null; rttMs: number | null; ageMs: number | null }
}

/**
 * The audio clock against real time, from its reads: per second the lowest lag (survives the Fire's
 * render blocks of up to 160 ms), seconds with fewer than 2 reads left out - a brief stall of the
 * page (a rotation) left one read in a second, and on the Fire one block step looked like a loss.
 * A loss counts only if the clock STAYS behind: the lowest lag of the 3 s after it against the 3 s
 * before (2026-11-06: "Audio-Uhr unruhig" came and went with nothing lost).
 */
export function audioClockVitals(samples: readonly { perf: number; ctxMs: number }[], now: number): AudioClockVitals | null {
  const first = samples[0]
  if (!first) return null
  const seconds: { t: number; lag: number; n: number }[] = []
  for (const s of samples) {
    const t = Math.floor(s.perf / 1000)
    const lag = s.perf - first.perf - (s.ctxMs - first.ctxMs)
    const last = seconds[seconds.length - 1]
    if (last && last.t === t) {
      last.lag = Math.min(last.lag, lag)
      last.n++
    } else seconds.push({ t, lag, n: 1 })
  }
  const floors = seconds.filter((second) => second.n >= MIN_READS_PER_SECOND)
  const lowest = (from: number, to: number) => Math.min(...floors.slice(from, to).map((f) => f.lag))
  let losses = 0
  let worstLossMs = 0
  for (let i = LOSS_SPAN_S; i + LOSS_SPAN_S <= floors.length; i++) {
    const lost = lowest(i, i + LOSS_SPAN_S) - lowest(i - LOSS_SPAN_S, i)
    if (lost <= CLOCK_LOSS_MS) continue
    if (floors[i]!.t * 1000 >= now - MINUTE_MS) {
      losses++
      worstLossMs = Math.max(worstLossMs, Math.round(lost))
    }
    // The same loss is behind every later "before" for a while - count it once.
    i += LOSS_SPAN_S - 1
  }
  const recent = floors.filter((f) => f.t * 1000 >= now - CLOCK_WINDOW_MS)
  const a = recent[0]
  const b = recent[recent.length - 1]
  if (!a || !b || b.t - a.t < 10) return { pct: null, losses, worstLossMs }
  const head = Math.min(...recent.slice(0, LOSS_SPAN_S).map((f) => f.lag))
  const tail = Math.min(...recent.slice(-LOSS_SPAN_S).map((f) => f.lag))
  const pct = -((tail - head) / ((b.t - a.t) * 1000)) * 100
  return { pct: Math.round(pct * 100) / 100, losses, worstLossMs }
}

/**
 * Whether a long frame from `at` lasting `ms` (performance time) is a hang, not the layout after a
 * rotation. The resize fires inside the long frame it causes, often well after its start (Redmi
 * 2026-11-07: a 208-ms frame, its resize handlers late in it) - so a frame still running when the
 * resize came counts as the rotation too.
 */
export function countsAsStall(at: number, ms: number, relayoutTimes: readonly number[]): boolean {
  return !relayoutTimes.some((r) => at + ms >= r - 100 && at <= r + RELAYOUT_GRACE_MS)
}

export interface Assessment {
  level: 'ok' | 'warning' | 'error'
  issues: VitalsIssue[]
}

/** The traffic light: what is wrong, worst first. Red only where sound or the device is failing (the
 * output switched over, Android out of memory). */
export function assessVitals(v: Pick<VitalsSnapshot, 'audio' | 'audioClock' | 'native' | 'stallsPerMin' | 'clock'>): Assessment {
  const errors: VitalsIssue[] = []
  const warnings: VitalsIssue[] = []
  if (v.audio?.fellBack) errors.push('audioFallback')
  // A loss is yellow: one stall of the whole phone is not a fault of the output (2026-11-06) - red
  // only once the safeguard switched over (audioFallback).
  if (v.audio && v.audio.missingMs > 0) warnings.push('audioMissing')
  if (v.audioClock && ((v.audioClock.pct !== null && Math.abs(v.audioClock.pct) > CLOCK_WARN_PCT) || v.audioClock.losses > 0)) warnings.push('audioClock')
  if (v.audio?.leadMinMs != null && v.audio.leadMinMs < TIGHT_LEAD_MS) warnings.push('audioTight')
  if (v.native?.lowMemory) errors.push('memoryLow')
  else if (v.native && v.native.availMb < Math.max(v.native.thresholdMb * 2, v.native.totalMb * 0.1)) warnings.push('memoryTight')
  if (v.stallsPerMin > 0) warnings.push('stalls')
  if (v.clock.ageMs !== null && (v.clock.ageMs > CLOCK_STALE_MS || (v.clock.uncertaintyMs ?? 0) > CLOCK_UNSURE_MS)) warnings.push('clockUnsure')
  const issues = [...errors, ...warnings]
  return { level: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok', issues }
}

/** For the 10-s device report (useDeviceInfoReporter.ts). */
export function summarizeVitals(v: VitalsSnapshot): DeviceVitalsSummary {
  const { level, issues } = assessVitals(v)
  return {
    level,
    issues,
    memAvailMb: v.native?.availMb ?? null,
    audioClockPct: v.audioClock?.pct ?? null,
    stallsPerMin: v.stallsPerMin,
    uptimeMin: Math.floor(v.uptimeMs / MINUTE_MS),
  }
}

const clockSamples: { perf: number; ctxMs: number }[] = []
const frames: { at: number; ms: number }[] = []
const relayouts: number[] = []
let framesWatched = false
let native: VitalsSnapshot['native'] = null
let lastCpu: { cpuMs: number; at: number } | null = null
let started = false

export const useDeviceVitalsStore = create<{ snapshot: VitalsSnapshot | null }>(() => ({ snapshot: null }))

export function vitalsSnapshot(): VitalsSnapshot {
  const now = performance.now()
  const wall = Date.now()
  while (frames.length > 0 && frames[0]!.at < now - MINUTE_MS) frames.shift()
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
  const sync = useClockSyncStore.getState()
  return {
    at: wall,
    audio: nativeOutputHealth(),
    audioClock: audioClockVitals(clockSamples, now),
    native,
    jsHeapMb: heap ? Math.round(heap.usedJSHeapSize / 1048576) : null,
    jsHeapLimitMb: heap ? Math.round(heap.jsHeapSizeLimit / 1048576) : null,
    stallsPerMin: frames.filter((f) => f.ms >= STALL_MS).length,
    worstFrameMs: Math.round(Math.max(0, ...frames.map((f) => f.ms))),
    framesWatched,
    uptimeMs: native?.uptimeMs ?? now,
    clock: { offsetMs: sync.offsetMs, uncertaintyMs: sync.jitterMs, rttMs: sync.rttMs, ageMs: sync.lastSyncedAt === null ? null : wall - sync.lastSyncedAt },
  }
}

async function readNative(): Promise<void> {
  try {
    const n = await DeviceVitals.read()
    const at = Date.now()
    const cpuPct = lastCpu ? Math.round(((n.cpuMs - lastCpu.cpuMs) / (at - lastCpu.at)) * 100) : null
    lastCpu = { cpuMs: n.cpuMs, at }
    native = { ...n, cpuPct }
  } catch {
    // An app built before DeviceVitalsPlugin: memory stays unknown.
  }
}

/** Starts watching (once, App.tsx). Cheap: one clock read every 250 ms, a native read every 10 s. */
export function startDeviceVitals(): void {
  if (started || typeof window === 'undefined') return
  started = true
  setInterval(() => {
    const ctx = peekSharedAudioContext()
    const perf = performance.now()
    if (!ctx || ctx.state !== 'running') {
      clockSamples.length = 0
      return
    }
    clockSamples.push({ perf, ctxMs: ctx.currentTime * 1000 })
    while (clockSamples.length > 0 && clockSamples[0]!.perf < perf - MINUTE_MS) clockSamples.shift()
  }, CLOCK_SAMPLE_MS)
  if (typeof PerformanceObserver !== 'undefined') {
    const type = PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame') ? 'long-animation-frame' : PerformanceObserver.supportedEntryTypes?.includes('longtask') ? 'longtask' : null
    if (type) {
      framesWatched = true
      const relayout = () => {
        relayouts.push(performance.now())
        while (relayouts.length > 10) relayouts.shift()
      }
      window.addEventListener('resize', relayout)
      window.addEventListener('orientationchange', relayout)
      window.visualViewport?.addEventListener('resize', relayout)
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (countsAsStall(entry.startTime, entry.duration, relayouts)) frames.push({ at: entry.startTime, ms: entry.duration })
      }).observe({ type })
    }
  }
  if (isNativeApp()) {
    void readNative()
    setInterval(() => void readNative(), NATIVE_READ_MS)
  }
  setInterval(() => useDeviceVitalsStore.setState({ snapshot: vitalsSnapshot() }), 2000)
}
