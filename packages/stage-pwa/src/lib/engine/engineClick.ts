import type { ClickTimeline } from '../beatGrid'
import type { ClickEngineState } from '../clickEngine'
import type { TransportState } from '../playbackTransport'
import { sharedAudioClock } from '../audioClock'
import { sourceOutput } from '../audioMix'
import { getServerTime } from '../clockSync'
import { getSharedAudioContext } from '../sharedAudioContext'
import { ENGINE_PROCESSOR, type EngineMessage, type EngineProcessorOptions, type EngineStatus } from './engineMessages'
import processorUrl from './engineProcessor.ts?worker&url'
import wasmUrl from './stageboard_engine.wasm?url'

/**
 * The click from the engine core in the AudioWorklet (docs/30 §8h stage 2) - the same interface as
 * clickEngine.ts (`startClick`/`stopClick` with a polled state), switched by `sb:debug:wasm-click`.
 *
 * clickEngine.ts queues each click 150 ms ahead from a 50 ms timer: when the timer stalls, clicks
 * are missing. Here the page hands over the whole plan instead - every beat of the song, the
 * transport, and now and then which output frame is heard at which band time - and the worklet
 * places each click itself, on the sample. The page's poll only notices changes; a stalled timer
 * delays a change, never a beat.
 */

/** Beats planned past bar 1 - an hour covers any song; a medley longer than that would click on to here. */
export const HORIZON_MS = 3_600_000
const POLL_MS = 50
/** How often the clock pair goes over - the engine learns the drift and glides between them. */
const CLOCK_MS = 500

/** Every beat of a timeline with its number (all, silent ones too - the plan's skeleton). */
export interface PlannedBeats {
  beat: Int32Array
  songMs: Float64Array
  accent: Uint8Array
}

function plan(timeline: ClickTimeline, from: number, fromMs: number | null, period: number | null, untilMs: number, keep?: { beat: number; songMs: number; accent: number }[]): PlannedBeats {
  const beats: number[] = []
  const times: number[] = []
  const accents: number[] = []
  for (const k of keep ?? []) {
    beats.push(k.beat)
    times.push(k.songMs)
    accents.push(k.accent)
  }
  let t = fromMs ?? timeline.timeOfBeat(from)
  for (let b = from; t < untilMs; b++) {
    beats.push(b)
    times.push(t)
    accents.push(timeline.beatInBar(b) === 0 ? 1 : 0)
    t = period !== null ? t + period : timeline.timeOfBeat(b + 1)
  }
  return { beat: Int32Array.from(beats), songMs: Float64Array.from(times), accent: Uint8Array.from(accents) }
}

/** All beats of `timeline`, count-in first, up to HORIZON_MS past bar 1. */
export function planBeats(timeline: ClickTimeline): PlannedBeats {
  return plan(timeline, timeline.firstBeat, null, null, timeline.bar1Ms + HORIZON_MS)
}

/**
 * A live tempo nudge (#140) on a grid without fixed tempo, while playing: the beats up to `nowMs`
 * and the next one keep their place, from there the new spacing runs on - as clickEngine.ts does.
 * Rebuilding from bar 1 instead would re-quantize the whole song onto the new tempo and move "the
 * next beat" by seconds (#25 review).
 */
export function nudgedBeats(previous: PlannedBeats, timeline: ClickTimeline, nowMs: number): PlannedBeats {
  let next = 0
  while (next < previous.songMs.length && previous.songMs[next]! <= nowMs) next++
  if (next === 0 || next >= previous.songMs.length) return planBeats(timeline)
  const keep = Array.from({ length: next }, (_, i) => ({ beat: previous.beat[i]!, songMs: previous.songMs[i]!, accent: previous.accent[i]! }))
  const from = previous.beat[next]!
  return plan(timeline, from, previous.songMs[next]!, timeline.periodAfter(from), timeline.bar1Ms + HORIZON_MS, keep)
}

/** The beats that sound - "Klick aus" cues (#485) leave theirs out; the rest keep their place. */
export function audibleBeats(planned: PlannedBeats, clickOnAt?: (songMs: number) => boolean): { songMs: Float64Array; accent: Uint8Array } {
  if (!clickOnAt) return { songMs: planned.songMs, accent: planned.accent }
  const songMs: number[] = []
  const accent: number[] = []
  planned.songMs.forEach((t, i) => {
    if (clickOnAt(t)) {
      songMs.push(t)
      accent.push(planned.accent[i]!)
    }
  })
  return { songMs: Float64Array.from(songMs), accent: Uint8Array.from(accent) }
}

const STOPPED: TransportState = { status: 'stopped', startedAt: null, accumulatedMs: 0 }

/** What the follower last sent, to send only changes. */
interface Sent {
  transport: string
  timeline: ClickTimeline | null
  clickOnAt: ClickEngineState['clickOnAt'] | null
  planned: PlannedBeats | null
}

/**
 * Turns the polled click state into engine messages - only what changed. Pure apart from `post`,
 * so the decisions can be tested without an AudioWorklet.
 */
export function createFollower(post: (m: EngineMessage) => void) {
  let sent: Sent = { transport: '', timeline: null, clickOnAt: null, planned: null }
  return {
    update(state: ClickEngineState): void {
      const playing = state.elapsedMs !== null && state.transport !== undefined
      const transport = playing ? state.transport! : STOPPED
      const key = JSON.stringify(transport)
      if (key !== sent.transport) post({ type: 'transport', transport })
      const { timeline, clickOnAt = null } = state
      if (timeline !== sent.timeline || clickOnAt !== sent.clickOnAt) {
        // A nudged tempo without a grid (both timelines unaligned) runs on from the next beat;
        // a grid or a new song is placed whole.
        const nudge = playing && sent.planned !== null && sent.timeline !== null && !timeline.rigid && !sent.timeline.rigid && timeline !== sent.timeline && key === sent.transport
        const planned = nudge ? nudgedBeats(sent.planned!, timeline, state.elapsedMs!) : planBeats(timeline)
        const { songMs, accent } = audibleBeats(planned, clickOnAt ?? undefined)
        post({ type: 'beats', songMs, accent })
        sent = { ...sent, timeline, clickOnAt, planned }
      }
      sent = { ...sent, transport: key }
    },
    reset(): void {
      sent = { transport: '', timeline: null, clickOnAt: null, planned: null }
    },
  }
}

interface Host {
  ctx: AudioContext
  node: AudioWorkletNode
}

let host: Promise<Host> | null = null
let poll: ReturnType<typeof setInterval> | null = null
let clock: ReturnType<typeof setInterval> | null = null
let follower: ReturnType<typeof createFollower> | null = null
let latestStatus: EngineStatus | null = null

/** The worklet node, made once per context: module compiled on the page, cloned into the worklet. */
function attach(ctx: AudioContext): Promise<Host> {
  if (host) return host
  host = (async () => {
    const module = await WebAssembly.compile(await (await fetch(wasmUrl)).arrayBuffer())
    await ctx.audioWorklet.addModule(processorUrl)
    const processorOptions: EngineProcessorOptions = { module }
    const node = new AudioWorkletNode(ctx, ENGINE_PROCESSOR, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions })
    node.port.onmessage = (e: MessageEvent<EngineStatus>) => {
      latestStatus = e.data
    }
    // Into the click's own mix level and routing, as clickEngine.ts's oscillators.
    node.connect(sourceOutput('click', ctx))
    return { ctx, node }
  })()
  host.catch(() => {
    host = null
  })
  return host
}

/** Frame being rendered now ↔ the band time it will be heard at: the same pair clickEngine.ts
 * schedules with (audio clock now, song clock now, output latency). */
function clockPair(ctx: AudioContext, outputLatencyMs: number): EngineMessage {
  return { type: 'clock', frame: Math.round(sharedAudioClock.now(ctx) * ctx.sampleRate), bandMs: getServerTime() + outputLatencyMs }
}

export function wasmClickWanted(): boolean {
  try {
    return localStorage.getItem('sb:debug:wasm-click') === '1'
  } catch {
    return false
  }
}

/** As clickEngine.ts `startClick`: safe to call repeatedly; the state is polled. */
export function startEngineClick(getState: () => ClickEngineState): void {
  if (poll !== null) return
  const ctx = getSharedAudioContext()
  void ctx.resume()
  const pending: EngineMessage[] = []
  let node: AudioWorkletNode | null = null
  const post = (m: EngineMessage) => (node ? node.port.postMessage(m) : pending.push(m))
  follower = createFollower(post)
  void attach(ctx).then((h) => {
    node = h.node
    for (const m of pending.splice(0)) node.port.postMessage(m)
  })
  const sendClock = () => post(clockPair(ctx, getState().outputLatencyMs ?? 0))
  sendClock()
  follower.update(getState())
  poll = setInterval(() => follower?.update(getState()), POLL_MS)
  clock = setInterval(sendClock, CLOCK_MS)
}

/** As clickEngine.ts `stopClick`: silent at once (the engine fades nothing - a click is 30 ms). */
export function stopEngineClick(): void {
  if (poll !== null) clearInterval(poll)
  if (clock !== null) clearInterval(clock)
  poll = clock = null
  void host?.then((h) => h.node.port.postMessage({ type: 'transport', transport: STOPPED } satisfies EngineMessage))
  follower = null
}

/** For the console: `await __sbEngine.status()` - frame, clock jumps, learned drift. */
if (typeof window !== 'undefined')
  (window as unknown as { __sbEngine: unknown }).__sbEngine = {
    status: async () => {
      const h = await host
      if (!h) return null
      h.node.port.postMessage({ type: 'status' } satisfies EngineMessage)
      await new Promise((r) => setTimeout(r, 50))
      return latestStatus
    },
  }
