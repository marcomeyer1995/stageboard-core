import { registerPlugin } from '@capacitor/core'
import { create } from 'zustand'
import { isNativeApp } from './native'

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
}

interface NativeOutputPlugin {
  /** Opens the stream and the loopback WebSocket the frames go to (`ws://127.0.0.1:port/token`). */
  start(options: { sampleRate: number }): Promise<{ started?: boolean; error?: string; performance?: string; framesPerBurst?: number; port: number; token: string }>
  status(): Promise<NativeOutputStatus>
  stop(): Promise<void>
}

const NativeOutput = registerPlugin<NativeOutputPlugin>('NativeOutput')

const SWITCH_KEY = 'sb:audio:native-output'
/** Frames per handover - 40 ms: fewer bridge calls than smaller chunks, still well inside the delay. */
const CHUNK_MS = 40
/** Added to the stream's own latency: rendering in bursts, the chunk, the handover (Fire: up to
 * ~150 ms from rendering to arrival through the main thread, measured 2026-11-05) and some reserve. */
const TRANSPORT_MS = 200
/** The render line is the earliest arrival of the last few seconds - a message is never early. */
const LINE_WINDOW_MS = 5000
/** How fast the line may follow a slow move (the audio clock against the wall clock, ppm). */
const LINE_SLEW_MS_PER_S = 0.5
/** A move larger than this is a new line (the context restarted, a long stall) - taken at once. */
const LINE_JUMP_MS = 20
/** The window the line's slope (the audio clock's rate) is read over. */
const RATE_WINDOW_MS = 30_000
/** How long to wait for the stream's first timestamp before choosing the delay. */
const LATENCY_WAIT_MS = 400
const STATUS_INTERVAL_MS = 2000

export type NativeOutputState = 'off' | 'starting' | 'on' | 'failed'

interface NativeOutputStore {
  /** This device wants its audio through the native output (stored per device). */
  wanted: boolean
  state: NativeOutputState
  /** From WebView rendering to hearing, fixed while on. */
  delayMs: number | null
  status: NativeOutputStatus | null
  error: string | null
  setWanted: (wanted: boolean) => void
}

function readSwitch(): boolean {
  try {
    return localStorage.getItem(SWITCH_KEY) === '1'
  } catch {
    return false
  }
}

export const useNativeOutputStore = create<NativeOutputStore>((set) => ({
  wanted: readSwitch(),
  state: 'off',
  delayMs: null,
  status: null,
  error: null,
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
 * the page, which schedules against it. */
const WORKER_SOURCE = `
let ws = null, rate = 48000, delayMs = null, line = null, lineAt = 0, arrivals = [], c = null
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
  arrivals.push({ at: now, v: now - (first + frames) * 1000 / rate })
  while (arrivals.length > 0 && arrivals[0].at < now - c.lineWindowMs) arrivals.shift()
  let edge = Infinity; for (const a of arrivals) if (a.v < edge) edge = a.v
  if (line === null || Math.abs(edge - line) > c.lineJumpMs) line = edge
  else { const step = c.lineSlewMsPerS * (now - lineAt) / 1000; line += Math.max(-step, Math.min(step, edge - line)) }
  lineAt = now
  postMessage({ type: 'line', at: now, line })
  if (delayMs === null || !ws || ws.readyState !== 1) return
  const msg = new ArrayBuffer(16 + pcm.byteLength), dv = new DataView(msg)
  dv.setFloat64(0, first, true); dv.setFloat64(8, line + delayMs, true)
  new Int16Array(msg, 16).set(pcm)
  ws.send(msg)
}
`

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
  closed: boolean
}

let pipe: Pipe | null = null
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
  const first = pipe.history[0]
  const last = pipe.history[pipe.history.length - 1]
  if (!first || !last || last.at - first.at < RATE_WINDOW_MS / 3) return 1
  return 1 - (last.line - first.line) / (last.at - first.at)
}

/** From scheduling to hearing while the native output is on - replaces the stored latency. */
export function nativeOutputDelayMs(): number | null {
  return pipe?.delayMs ?? null
}

function onLine(p: Pipe, at: number, line: number): void {
  p.line = line
  p.history.push({ at, line })
  while (p.history.length > 0 && p.history[0]!.at < at - RATE_WINDOW_MS) p.history.shift()
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
    const p: Pipe = { ctx, tap, worker, silent, rate: ctx.sampleRate, chunk, delayMs: null, line: null, history: [], timer: null, closed: false }
    pipe = p
    const started = await NativeOutput.start({ sampleRate: ctx.sampleRate })
    if (!started.started) throw new Error(started.error ?? 'start')
    const opened = new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ type: string; at: number; line: number }>) => {
        if (e.data.type === 'line') onLine(p, e.data.at, e.data.line)
        else if (e.data.type === 'open') resolve()
        else if (e.data.type === 'closed') reject(new Error('connection closed'))
      }
    })
    const channel = new MessageChannel()
    const constants = { lineWindowMs: LINE_WINDOW_MS, lineJumpMs: LINE_JUMP_MS, lineSlewMsPerS: LINE_SLEW_MS_PER_S }
    worker.postMessage({ type: 'init', rate: ctx.sampleRate, url: `ws://127.0.0.1:${started.port}/${started.token}`, port: channel.port1, constants }, [channel.port1])
    tap.port.postMessage({ port: channel.port2 }, [channel.port2])
    await opened
    await new Promise((resolve) => setTimeout(resolve, LATENCY_WAIT_MS))
    const status = await NativeOutput.status()
    if (p.closed) return
    if (!status.open || status.latencyMs === undefined || status.latencyMs < 0) throw new Error('no timestamp')
    p.delayMs = Math.round(status.latencyMs + TRANSPORT_MS)
    worker.postMessage({ type: 'delay', delayMs: p.delayMs })
    rewire(ctx, tap)
    useNativeOutputStore.setState({ state: 'on', delayMs: p.delayMs, status })
    p.timer = setInterval(() => {
      void NativeOutput.status().then((s) => useNativeOutputStore.setState({ status: s }), () => {})
    }, STATUS_INTERVAL_MS)
  } catch (error) {
    detach()
    useNativeOutputStore.setState({ state: store.wanted ? 'failed' : 'off', error: error instanceof Error ? error.message : String(error) })
  }
}

function detach(): void {
  const p = pipe
  if (!p) return
  pipe = null
  p.closed = true
  if (p.timer) clearInterval(p.timer)
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

if (typeof window !== 'undefined') (window as unknown as { __sbNativeOutput: unknown }).__sbNativeOutput = { state: () => useNativeOutputStore.getState(), now: () => (pipe ? { line: pipe.line, delayMs: pipe.delayMs, rate: pipe.rate } : null) }
