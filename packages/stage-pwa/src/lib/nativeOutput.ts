import { registerPlugin } from '@capacitor/core'
import type { AudioOutputHealth } from 'shared-types'
import { create } from 'zustand'
import { isNativeApp } from './native'
import { audible, FALLBACK_SPAN_MS, FALLBACK_WINDOW_MS, missingInWindowMs, quietUntil, shouldFallBack, SOUND_LEVEL, trackLossEpisodes, type MissingSample } from './nativeOutputFallback'

/**
 * Native audio output (docs/30, Marco 2026-11-05: "pipe the mix"). Everything keeps playing on the
 * shared AudioContext as before - track, stems, click, announcements, time stretch, the mix - but its
 * last node no longer goes to the WebView's speaker: an AudioWorklet taps it and the frames are
 * handed to the app's own AAudio stream (NativeOutputPlugin.java, native_output.cpp), which plays
 * each one at a wall-clock time we choose: when the WebView rendered it plus a fixed delay.
 *
 * Why: the WebView reports how late its sound is heard, and on the Fire that report is up to 180 ms
 * wrong, differently at every app start (measured 2026-11-05: 24 ms or 160 ms after the native click)
 * - no compensation can follow that. AAudio's own timestamp was truthful on every device we have, so
 * with this path the delay is ours and exact, and the band's devices are heard together without a
 * stored latency. Android only (the app); the browser and iOS keep the WebView's output.
 */

interface NativeOutputStatus {
  open: boolean
  latencyMs?: number
  leadMs?: number
  leadMinMs?: number
  jumps?: number
  timestampJumps?: number
  rateDevPpm?: number
  missing?: number
  xruns?: number
  reopens?: number
  performance?: string
  engine?: boolean
  engineClockJumps?: number
  engineDriftPpm?: number
  /** Streamed clips: pieces with frames missing (decoder behind, unannounced jump) / dropped (§8i). */
  engineMissingReads?: number
  engineBrokenReads?: number
  /** No timestamp from Android: playing on an estimated one - on time only roughly (2026-11-12). */
  estimated?: boolean
}

interface NativeOutputPlugin {
  /** Opens the stream and the loopback WebSocket the frames go to (`ws://127.0.0.1:port/token`). */
  start(options: { sampleRate: number }): Promise<{ started?: boolean; error?: string; performance?: string; framesPerBurst?: number; port: number; token: string }>
  status(): Promise<NativeOutputStatus>
  stop(): Promise<void>
  engineEnable(options: { on: boolean }): Promise<void>
  engineTransport(options: { status: number; startedAt: number; accumulatedMs: number; rate: number; hasJump: boolean; jumpAt: number; jumpToMs: number; jumpRate: number }): Promise<void>
  engineBeats(options: { songMs: number[]; accent: number[] }): Promise<void>
  engineOffset(options: { offsetMs: number }): Promise<void>
  engineGain(options: { bus: number; gain: number }): Promise<void>
  engineFeeds(options: { bus: number; left: number; right: number }): Promise<void>
  clipBegin(options: { id: number; size: number }): Promise<void>
  clipChunk(options: { id: number; offset: number; data: string }): Promise<{ ok: boolean }>
  clipCommit(options: { id: number; songStartMs: number; bus: number; gain: number }): Promise<{ error: string }>
  clipRemove(options: { id: number }): Promise<void>
  clipGain(options: { id: number; gain: number }): Promise<void>
}

const NativeOutput = registerPlugin<NativeOutputPlugin>('NativeOutput')

/** Fire and forget: on a locked screen a plugin's answer can be held back for minutes (Fire,
 * 2026-11-10) - nothing waits for it. */
function send(call: Promise<void>): void {
  call.catch(() => {})
}

/**
 * The engine core inside the native callback (docs/30 §8h stage 3, native_output.cpp): the click
 * is placed there from AAudio's timestamp, independent of the WebView. Each call only hands over a
 * change; engine/nativeEngineClick.ts decides what.
 */
export const nativeEngine = {
  enable: (on: boolean) => send(NativeOutput.engineEnable({ on })),
  transport: (t: { status: number; startedAt: number; accumulatedMs: number; rate: number; hasJump: boolean; jumpAt: number; jumpToMs: number; jumpRate: number }) => send(NativeOutput.engineTransport(t)),
  beats: (songMs: Float64Array, accent: Uint8Array) => send(NativeOutput.engineBeats({ songMs: Array.from(songMs), accent: Array.from(accent) })),
  /** Band time - wall clock: the server offset plus this output's trim. */
  offset: (offsetMs: number) => send(NativeOutput.engineOffset({ offsetMs })),
  /** `bus` as engine.h (0 click), -1 the master. */
  gain: (bus: number, gain: number) => send(NativeOutput.engineGain({ bus, gain })),
  /** Where bus `bus` goes on the output: each side engine.h's Feed (nativeEngineSession.ts FEED). */
  feeds: (bus: number, left: number, right: number) => send(NativeOutput.engineFeeds({ bus, left, right })),
  /** A streamed clip (docs/30 §8h stage 4): the Ogg Opus file in pieces, then placed - awaited,
   * a song change loads its track before it plays (nativeEngineTrack.ts). */
  clipBegin: (id: number, size: number) => NativeOutput.clipBegin({ id, size }),
  clipChunk: (id: number, offset: number, data: string) => NativeOutput.clipChunk({ id, offset, data }),
  clipCommit: (id: number, songStartMs: number, bus: number, gain: number) => NativeOutput.clipCommit({ id, songStartMs, bus, gain }),
  clipRemove: (id: number) => send(NativeOutput.clipRemove({ id })),
  clipGain: (id: number, gain: number) => send(NativeOutput.clipGain({ id, gain })),
}

const SWITCH_KEY = 'sb:audio:native-output'
/** Frames per handover - 40 ms: fewer bridge calls than smaller chunks, still well inside the delay. */
const CHUNK_MS = 40
/** Added to the stream's own latency: rendering in bursts, the chunk, the handover (Fire: up to
 * ~150 ms from rendering to arrival through the main thread, measured 2026-11-05) and some reserve. */
const TRANSPORT_MS = 200
/** Where the reserve learned so far is kept (per device): a WebView that renders in large blocks
 * delivers its frames unevenly (the Fire in Solo: 10-180 ms ahead, 2026-11-05). */
const EXTRA_KEY = 'sb:audio:native-output-extra'
/** When the frames were ever this close to being late, the next start gets EXTRA_STEP_MS more. */
const TIGHT_LEAD_MS = 30
const EXTRA_STEP_MS = 50
const EXTRA_MAX_MS = 400

function readExtra(): number {
  try {
    return Math.min(EXTRA_MAX_MS, Math.max(0, Number(localStorage.getItem(EXTRA_KEY)) || 0))
  } catch {
    return 0
  }
}

/** Learns more reserve for the next start - never changed while on: a new delay moves the audio. */
function learnExtra(leadMinMs: number | undefined, appliedExtra: number): void {
  if (leadMinMs === undefined || leadMinMs < 0 || leadMinMs >= TIGHT_LEAD_MS) return
  const next = Math.min(EXTRA_MAX_MS, appliedExtra + EXTRA_STEP_MS)
  if (next <= readExtra()) return
  try {
    localStorage.setItem(EXTRA_KEY, String(next))
  } catch {
    // Blocked storage: the reserve stays as it is.
  }
}
/** The render line: a straight line through the earliest arrival of each second of the last minute
 * (see the worker) - an arrival is never early, often late. */
const FIT_WINDOW_MS = 60_000
/** Until this many seconds are in, the line has no slope yet. */
const MIN_FIT_SECONDS = 5
/** Its height: the earliest of the seconds' earliest arrivals around the slope - an arrival is
 * never early, so loaded seconds (late arrivals) can't lift it, and anything higher than the
 * earliest let the line fall behind the WebView's own clock (the schedulers then clamped to
 * `currentTime`, and the two disagreed by up to 10 ms from one song start to the next). */
const EDGE_QUANTILE = 0
/** For this long after the start the line takes the edge at once (see the worker). */
const SETTLE_MS = 60_000
/** A steeper slope than 0.2 % is not a clock but a failure. */
const MAX_LINE_SLOPE = 0.002
/** How fast the line is pulled to the edge on top of its slope. */
const LINE_SLEW_MS_PER_S = 0.5
/** A move larger than this is a new line (the context restarted, a long stall) - taken at once.
 * Smaller ones are slewed: when the WebView's renderer stalls (the phone at a song start), its
 * clock falls behind, but every frame still plays by its number at the right time - only the
 * reserve shrinks. Jumping at 20 ms moved everything already scheduled by the stall (+22 ms on the
 * phone, the click took 5 s to come back, 2026-11-05). */
const LINE_JUMP_MS = 100
/** All arrivals this long past the line by more than LINE_JUMP_MS: a lasting shift (see the worker). */
const SHIFT_HOLD_MS = 2000
/** The window the line's slope (the audio clock's rate) is read over. */
const RATE_WINDOW_MS = 30_000
/** How long to wait for the stream's first timestamp before choosing the delay. */
const LATENCY_WAIT_MS = 400
const STATUS_INTERVAL_MS = 2000
/** The health the device reports (nativeOutputHealth) looks back this far. */
const HEALTH_WINDOW_MS = 60_000

export type NativeOutputState = 'off' | 'starting' | 'on' | 'failed'

interface NativeOutputStore {
  /** This device wants its audio through the native output (stored per device). */
  wanted: boolean
  state: NativeOutputState
  /** From WebView rendering to hearing, fixed while on. */
  delayMs: number | null
  status: NativeOutputStatus | null
  error: string | null
  /** The native output lost too much audio and this device plays through the WebView instead,
   * until the app restarts (nativeOutputFallback.ts) - the stored switch stays on. */
  fellBack: { at: number; missingMs: number } | null
  setWanted: (wanted: boolean) => void
}

/** On unless switched off on this device (Marco, 2026-11-05: on by default) - only where it exists
 * (the Android app, nativeOutputAvailable). */
function readSwitch(): boolean {
  try {
    return localStorage.getItem(SWITCH_KEY) !== '0'
  } catch {
    return true
  }
}

export const useNativeOutputStore = create<NativeOutputStore>((set) => ({
  wanted: readSwitch(),
  state: 'off',
  delayMs: null,
  status: null,
  error: null,
  fellBack: null,
  setWanted: (wanted) => {
    try {
      localStorage.setItem(SWITCH_KEY, wanted ? '1' : '0')
    } catch {
      // Blocked storage: applies until the app is reloaded.
    }
    set({ wanted })
  },
}))

/** Whether this device can use the native output at all. */
export function nativeOutputAvailable(): boolean {
  return isNativeApp()
}

/** The worklet: collects CHUNK frames, converts to interleaved int16 and posts them with the
 * number of their first frame - to the worker's port once it has one, never through the main
 * thread. String modules (blob URLs) - small, no bundler entries. */
const TAP_SOURCE = `
class Tap extends AudioWorkletProcessor {
  constructor(options) { super(); this.size = options.processorOptions.chunk; this.buf = new Int16Array(this.size * 2); this.n = 0; this.first = 0; this.out = null
    this.port.onmessage = (e) => { this.out = e.data.port } }
  process(inputs) {
    const input = inputs[0]
    const l = input && input[0], r = input && (input[1] || input[0])
    const frames = l ? l.length : 128
    for (let i = 0; i < frames; i++) {
      if (this.n === 0) this.first = currentFrame + i
      const a = l ? l[i] : 0, b = r ? r[i] : 0
      this.buf[2 * this.n] = Math.max(-1, Math.min(1, a)) * 32767
      this.buf[2 * this.n + 1] = Math.max(-1, Math.min(1, b)) * 32767
      if (++this.n === this.size) {
        if (this.out) {
          this.out.postMessage({ first: this.first, pcm: this.buf }, [this.buf.buffer])
          this.buf = new Int16Array(this.size * 2)
        }
        this.n = 0
      }
    }
    return true
  }
}
registerProcessor('sb-native-output', Tap)
`

/** The worker: takes the chunks from the worklet, keeps the render line (the lower edge of the
 * arrivals - a chunk never arrives before it was rendered, often later) and sends each chunk with
 * the wall-clock time its frame 0 is to be heard over the loopback WebSocket. Reports the line to
 * the page, which schedules against it.
 *
 * The edge is a straight line through the earliest arrival of each second over the last minute -
 * slope by Theil-Sen (robust), height at the earliest residual - because the WebView's
 * clock drifts against the wall clock (the Redmi by more than 0.5 ms/s: a line slewed at most that
 * fast lagged ever further behind, 2026-11-05), and a few seconds of late arrivals (load at a song
 * start) must not lift it. The line moves with that slope and is pulled to the edge slowly. */
const WORKER_SOURCE = `
let ws = null, rate = 48000, delayMs = null, line = null, lineAt = 0, startedAt = 0, buckets = [], slope = 0, fitAt = 0, c = null, aboveSince = null, aboveMin = 0, soundAt = -Infinity
function theilSen(points) {
  const s = []
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) s.push((points[j].min - points[i].min) / (points[j].t - points[i].t))
  s.sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}
onmessage = (e) => {
  const m = e.data
  if (m.type === 'init') {
    rate = m.rate; c = m.constants
    m.port.onmessage = (ev) => chunk(ev.data.first, ev.data.pcm)
    ws = new WebSocket(m.url); ws.binaryType = 'arraybuffer'
    ws.onopen = () => postMessage({ type: 'open' })
    ws.onclose = () => postMessage({ type: 'closed' })
  } else if (m.type === 'delay') delayMs = m.delayMs
  else if (m.type === 'close') { ws && ws.close(); close() }
}
function chunk(first, pcm) {
  const now = Date.now(), frames = pcm.length / 2
  // Sound in the mix - at most once a second (nativeOutputFallback.ts: a gap in silence does not count).
  if (now - soundAt >= 1000) {
    for (let i = 0; i < pcm.length; i++) if (pcm[i] > c.soundLevel || pcm[i] < -c.soundLevel) { soundAt = now; postMessage({ type: 'sound', at: now }); break }
  }
  const v = now - (first + frames) * 1000 / rate
  // Every arrival held far behind the line: the WebView's clock lost time for good (a rotation on
  // the Redmi stopped it ~0.5 s, 2026-11-06) - the edge of the last minute is from before and would
  // keep the line there for a minute, every frame "late". Start the fit again from the shift.
  if (line !== null && v - line > c.lineJumpMs) {
    if (aboveSince === null) { aboveSince = now; aboveMin = v } else aboveMin = Math.min(aboveMin, v)
    if (now - aboveSince >= c.shiftHoldMs) { buckets = [{ t: Math.floor(now / 1000) * 1000, min: aboveMin }]; line = aboveMin; aboveSince = null }
  } else aboveSince = null
  const second = Math.floor(now / 1000) * 1000, last = buckets[buckets.length - 1]
  if (last && last.t === second) last.min = Math.min(last.min, v)
  else buckets.push({ t: second, min: v })
  while (buckets.length > 0 && buckets[0].t < now - c.fitWindowMs) buckets.shift()
  if (buckets.length >= c.minBuckets && now - fitAt >= 500) {
    fitAt = now
    slope = Math.max(-c.maxSlope, Math.min(c.maxSlope, theilSen(buckets)))
  }
  const residuals = buckets.map((b) => b.min - slope * (b.t - now)).sort((a, b) => a - b)
  const edge = residuals[Math.floor(c.edgeQuantile * (residuals.length - 1))]
  if (line === null) startedAt = now
  // In the first minute the line takes the edge as it is: the first arrivals came late under the
  // start's load, the line began up to 40 ms late and was slewed back over a minute (Fire, 2026-11-05).
  if (line === null || now - startedAt < c.settleMs || Math.abs(edge - line) > c.lineJumpMs) line = edge
  else {
    const dt = now - lineAt, step = c.lineSlewMsPerS * dt / 1000
    line += slope * dt
    line += Math.max(-step, Math.min(step, edge - line))
  }
  lineAt = now
  postMessage({ type: 'line', at: now, line })
  if (delayMs === null || !ws || ws.readyState !== 1) return
  const msg = new ArrayBuffer(16 + pcm.byteLength), dv = new DataView(msg)
  dv.setFloat64(0, first, true); dv.setFloat64(8, line + delayMs, true)
  new Int16Array(msg, 16).set(pcm)
  ws.send(msg)
}
`

const WORKER_CONSTANTS = { settleMs: SETTLE_MS, fitWindowMs: FIT_WINDOW_MS, minBuckets: MIN_FIT_SECONDS, maxSlope: MAX_LINE_SLOPE, edgeQuantile: EDGE_QUANTILE, lineJumpMs: LINE_JUMP_MS, lineSlewMsPerS: LINE_SLEW_MS_PER_S, shiftHoldMs: SHIFT_HOLD_MS, soundLevel: SOUND_LEVEL }

/** Test-only: the worker's source and constants, to run it with simulated arrivals. */
export const __nativeOutputWorkerForTests = { source: WORKER_SOURCE, constants: WORKER_CONSTANTS }

interface Pipe {
  ctx: AudioContext
  tap: AudioWorkletNode
  worker: Worker
  silent: GainNode
  rate: number
  chunk: number
  delayMs: number | null
  /** Wall-clock ms at which context frame 0 was rendered (from the worker). */
  line: number | null
  /** The line over the last RATE_WINDOW_MS, for its slope. */
  history: { at: number; line: number }[]
  timer: ReturnType<typeof setInterval> | null
  /** Stops watching the page's visibility (the lock grace, nativeOutputFallback.ts). */
  unwatch: (() => void) | null
  /** When the mix last carried sound (from the worker) - gaps in silence don't count. */
  soundAt: number | null
  closed: boolean
}

let pipe: Pipe | null = null
/** The native output's counters over the last HEALTH_WINDOW_MS (status polls). */
const healthSamples: { at: number; missing: number; jumps: number; leadMinMs: number | null }[] = []

/**
 * This device's audio output health for the Geräte tab (docs/30): native or WebView, the delay,
 * and over the last minute the audio missing, the hard jumps and the smallest reserve. Null in a
 * browser (no native output to watch).
 */
export function nativeOutputHealth(): AudioOutputHealth | null {
  if (!nativeOutputAvailable()) return null
  if (!pipe || pipe.delayMs === null) return { path: 'webview', delayMs: null, missingMs: 0, jumps: 0, leadMinMs: null, fellBack: useNativeOutputStore.getState().fellBack !== null }
  const first = healthSamples[0]
  const last = healthSamples[healthSamples.length - 1]
  const leads = healthSamples.map((h) => h.leadMinMs).filter((v): v is number => v !== null && v >= 0)
  return {
    path: 'native',
    delayMs: pipe.delayMs,
    missingMs: first && last ? Math.round(((last.missing - first.missing) * 1000) / pipe.rate) : 0,
    jumps: first && last ? Math.max(0, last.jumps - first.jumps) : 0,
    leadMinMs: leads.length > 0 ? Math.round(Math.min(...leads)) : null,
    ...(useNativeOutputStore.getState().status?.estimated ? { estimated: true } : {}),
  }
}
/** Per context: the one node every source ends in - to the speaker, or to the tap. */
const masters = new Map<AudioContext, GainNode>()

/** Where the mix leaves the context: connect here instead of `ctx.destination`. */
export function masterOutput(ctx: AudioContext): AudioNode {
  let master = masters.get(ctx)
  if (!master) {
    master = ctx.createGain()
    master.connect(pipe?.ctx === ctx && pipe.delayMs !== null ? pipe.tap : ctx.destination)
    masters.set(ctx, master)
  }
  return master
}

function rewire(ctx: AudioContext, toTap: AudioNode | null): void {
  const master = masters.get(ctx)
  if (!master) return
  master.disconnect()
  master.connect(toTap ?? ctx.destination)
}

/**
 * The context time being rendered now, read from the native output's line - what the schedulers
 * place their audio against while it is on (null otherwise: they use the WebView's clock).
 */
export function nativeOutputNow(ctx: AudioContext): number | null {
  if (!pipe || pipe.ctx !== ctx || pipe.line === null || pipe.delayMs === null) return null
  return (Date.now() - pipe.line) / 1000
}

/** Audio seconds per wall-clock second while the native output is on (null otherwise): the line
 * moves as the audio clock runs off the wall clock (the Redmi −247 ppm, docs/29 §11). */
export function nativeOutputAudioPerWall(ctx: AudioContext): number | null {
  if (!pipe || pipe.ctx !== ctx || pipe.line === null || pipe.delayMs === null) return null
  return lineAudioPerWall(pipe.history)
}

/** Audio seconds per wall-clock second from the line's history - 1 until a third of the window is
 * in, never further off than MAX_LINE_SLOPE (a real audio clock never is). */
export function lineAudioPerWall(history: readonly { at: number; line: number }[]): number {
  const first = history[0]
  const last = history[history.length - 1]
  if (!first || !last || last.at - first.at < RATE_WINDOW_MS / 3) return 1
  const slope = (last.line - first.line) / (last.at - first.at)
  return 1 - Math.max(-MAX_LINE_SLOPE, Math.min(MAX_LINE_SLOPE, slope))
}

/**
 * Adds a line reading; a jump starts the history anew (Marco, 2026-11-07). The Redmi's screen was
 * locked 11 s: the WebView's clock stood still, the line moved on by seconds, and over the 30-s
 * window that read as an audio clock 8 % slow - the track played 8 % fast (more than a semitone
 * high) and restarted every few seconds until the jump left the window. A rotation (0.5 s) did the
 * same at ~1.7 %.
 */
export function pushLine(history: { at: number; line: number }[], at: number, line: number): void {
  const last = history[history.length - 1]
  if (last && Math.abs(line - last.line) > LINE_JUMP_MS) history.length = 0
  history.push({ at, line })
  while (history.length > 0 && history[0]!.at < at - RATE_WINDOW_MS) history.shift()
}

/** From scheduling to hearing while the native output is on - replaces the stored latency. */
export function nativeOutputDelayMs(): number | null {
  return pipe?.delayMs ?? null
}

function onLine(p: Pipe, at: number, line: number): void {
  p.line = line
  pushLine(p.history, at, line)
}

async function attach(ctx: AudioContext): Promise<void> {
  const store = useNativeOutputStore.getState()
  if (pipe?.ctx === ctx || !nativeOutputAvailable()) return
  useNativeOutputStore.setState({ state: 'starting', error: null })
  try {
    const url = URL.createObjectURL(new Blob([TAP_SOURCE], { type: 'text/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const chunk = Math.round((ctx.sampleRate * CHUNK_MS) / 1000)
    const tap = new AudioWorkletNode(ctx, 'sb-native-output', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', processorOptions: { chunk } })
    // The tap must be pulled by the destination to run - through a silent gain: the WebView's own
    // output stays quiet while the native one plays.
    const silent = ctx.createGain()
    silent.gain.value = 0
    tap.connect(silent).connect(ctx.destination)
    const workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
    const worker = new Worker(workerUrl)
    URL.revokeObjectURL(workerUrl)
    const p: Pipe = { ctx, tap, worker, silent, rate: ctx.sampleRate, chunk, delayMs: null, line: null, history: [], timer: null, unwatch: null, soundAt: null, closed: false }
    pipe = p
    const started = await NativeOutput.start({ sampleRate: ctx.sampleRate })
    if (!started.started) throw new Error(started.error ?? 'start')
    const opened = new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ type: string; at: number; line: number }>) => {
        if (e.data.type === 'line') onLine(p, e.data.at, e.data.line)
        else if (e.data.type === 'sound') p.soundAt = e.data.at
        else if (e.data.type === 'open') resolve()
        else if (e.data.type === 'closed') reject(new Error('connection closed'))
      }
    })
    const channel = new MessageChannel()
    const constants = WORKER_CONSTANTS
    worker.postMessage({ type: 'init', rate: ctx.sampleRate, url: `ws://127.0.0.1:${started.port}/${started.token}`, port: channel.port1, constants }, [channel.port1])
    tap.port.postMessage({ port: channel.port2 }, [channel.port2])
    await opened
    await new Promise((resolve) => setTimeout(resolve, LATENCY_WAIT_MS))
    const status = await NativeOutput.status()
    if (p.closed) return
    if (!status.open || status.latencyMs === undefined || status.latencyMs < 0) throw new Error('no timestamp')
    // The WebView's own block size (Fire: 64-160 ms) adds to how unevenly its frames arrive.
    const extra = readExtra()
    p.delayMs = Math.round(status.latencyMs + TRANSPORT_MS + Math.max(0, ctx.baseLatency * 1000 - 20) + extra)
    worker.postMessage({ type: 'delay', delayMs: p.delayMs })
    rewire(ctx, tap)
    useNativeOutputStore.setState({ state: 'on', delayMs: p.delayMs, status, fellBack: null })
    const startedAt = Date.now()
    healthSamples.length = 0
    const recent: MissingSample[] = []
    let quiet = quietUntil(document.visibilityState === 'hidden', Date.now())
    const onVisibility = () => {
      quiet = quietUntil(document.visibilityState === 'hidden', Date.now())
    }
    document.addEventListener('visibilitychange', onVisibility)
    p.unwatch = () => document.removeEventListener('visibilitychange', onVisibility)
    let episodes: number[] = []
    let lost: { at: number; ms: number }[] = []
    p.timer = setInterval(() => {
      void NativeOutput.status().then((s) => {
        if (p.closed) return
        const now = Date.now()
        // Screen locked, or just unlocked: what goes missing is the lock, not the output - no loss,
        // no health sample, and no bigger reserve learned from it. Nothing sounding: a gap is inaudible.
        if (now < quiet || !audible(p.soundAt, now)) {
          recent.length = 0
          healthSamples.length = 0
          useNativeOutputStore.setState({ status: s })
          return
        }
        learnExtra(s.leadMinMs, extra)
        recent.push({ at: now, missing: s.missing ?? 0 })
        while (recent.length > 0 && recent[0]!.at < now - FALLBACK_WINDOW_MS) recent.shift()
        const tracked = trackLossEpisodes(episodes, recent, now, p.rate, startedAt)
        episodes = tracked.episodes
        if (tracked.started) {
          const ms = Math.round(missingInWindowMs(recent, now, p.rate))
          lost = [...lost.filter((l) => l.at >= now - FALLBACK_SPAN_MS), { at: now, ms }]
          console.warn(`[native-output] ${ms} ms audio missing in ${FALLBACK_WINDOW_MS / 1000} s (${episodes.length}. time in ${FALLBACK_SPAN_MS / 60_000} min)`)
        }
        if (shouldFallBack(episodes)) {
          fallBack(lost.reduce((sum, l) => sum + l.ms, 0), episodes.length)
          return
        }
        // The first minute settles on purpose (the line takes the edge at once) - not a fault.
        if (Date.now() - startedAt >= SETTLE_MS) healthSamples.push({ at: Date.now(), missing: s.missing ?? 0, jumps: s.jumps ?? 0, leadMinMs: s.leadMinMs ?? null })
        while (healthSamples.length > 0 && healthSamples[0]!.at < Date.now() - HEALTH_WINDOW_MS) healthSamples.shift()
        useNativeOutputStore.setState({ status: s })
      }, () => {})
    }, STATUS_INTERVAL_MS)
  } catch (error) {
    detach()
    useNativeOutputStore.setState({ state: store.wanted ? 'failed' : 'off', error: error instanceof Error ? error.message : String(error) })
  }
}

/** Back to the WebView's own output for the rest of this app run (nativeOutputFallback.ts). */
function fallBack(missingMs: number, times: number): void {
  console.error(`[native-output] audio missing ${times} times in ${FALLBACK_SPAN_MS / 60_000} min (${missingMs} ms) - switched to the WebView's output until the app restarts`)
  detach()
  useNativeOutputStore.setState({ fellBack: { at: Date.now(), missingMs } })
}

function detach(): void {
  const p = pipe
  if (!p) return
  pipe = null
  p.closed = true
  if (p.timer) clearInterval(p.timer)
  p.unwatch?.()
  rewire(p.ctx, null)
  p.worker.postMessage({ type: 'close' })
  p.tap.disconnect()
  p.silent.disconnect()
  void NativeOutput.stop().catch(() => {})
  useNativeOutputStore.setState({ state: 'off', delayMs: null, status: null })
}

let current: AudioContext | null = null

/** Called with the shared AudioContext when it is created: follows the switch from then on. */
export function followNativeOutput(ctx: AudioContext): void {
  current = ctx
  if (useNativeOutputStore.getState().wanted) void attach(ctx)
}

useNativeOutputStore.subscribe((state, before) => {
  if (state.wanted === before.wanted || !current) return
  if (state.wanted) void attach(current)
  else detach()
})

/** Test-only. */
export function __resetNativeOutputForTests(): void {
  detach()
  masters.clear()
  current = null
}

if (typeof window !== 'undefined') (window as unknown as { __sbNativeOutput: unknown }).__sbNativeOutput = { state: () => useNativeOutputStore.getState(), health: () => nativeOutputHealth(), now: () => (pipe ? { line: pipe.line, delayMs: pipe.delayMs, rate: pipe.rate } : null) }
