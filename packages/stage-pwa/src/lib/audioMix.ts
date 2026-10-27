import { create } from 'zustand'
import { getSharedAudioContext } from './sharedAudioContext'

/**
 * "Mein Mix" (docs/21 §9.3): how loud backing track, click and spoken announcements play on this
 * device - one slider each, plus mute. Per device (localStorage), for whoever listens here: Solo
 * practice and the Timeline editor use it, and until the stage mix exists (§9.3 step 3) so does
 * Gig mode on the device that plays.
 *
 * Every source plays through its own gain node on the shared AudioContext (`sourceOutput`), so a
 * change is heard at once, also mid-song. The track's `<audio>` element (Solo practice, Timeline)
 * can't go above full volume - that's why the track tops out at 100 %, click and voice at 200 %.
 */

export type MixSource = 'track' | 'click' | 'voice'
export const MIX_SOURCES: readonly MixSource[] = ['track', 'click', 'voice']
export const MIX_LABELS: Record<MixSource, string> = { track: 'Track', click: 'Klick', voice: 'Ansagen' }
/** Highest level per source, 1 = as loud as before the mix existed. */
export const MIX_MAX: Record<MixSource, number> = { track: 1, click: 2, voice: 2 }

export interface MixChannel {
  level: number
  muted: boolean
}
export type Mix = Record<MixSource, MixChannel>

export const DEFAULT_MIX: Mix = { track: { level: 1, muted: false }, click: { level: 1, muted: false }, voice: { level: 1, muted: false } }

const STORAGE_KEY = 'sb:audio:mix'

function clampLevel(source: MixSource, level: number): number {
  return Number.isFinite(level) ? Math.min(MIX_MAX[source], Math.max(0, level)) : 1
}

/** The stored mix, every missing or broken entry back to its default. */
export function parseMix(raw: unknown): Mix {
  const mix: Mix = { ...DEFAULT_MIX }
  if (!raw || typeof raw !== 'object') return mix
  for (const source of MIX_SOURCES) {
    const entry = (raw as Record<string, unknown>)[source]
    if (!entry || typeof entry !== 'object') continue
    const { level, muted } = entry as Record<string, unknown>
    mix[source] = { level: typeof level === 'number' ? clampLevel(source, level) : 1, muted: muted === true }
  }
  return mix
}

function loadMix(): Mix {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return parseMix(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_MIX }
  }
}

function saveMix(mix: Mix): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mix))
  } catch {
    // Blocked storage: the mix applies until the app is reloaded.
  }
}

interface AudioMixState {
  mix: Mix
  setLevel: (source: MixSource, level: number) => void
  setMuted: (source: MixSource, muted: boolean) => void
}

export const useAudioMixStore = create<AudioMixState>((set, get) => ({
  mix: loadMix(),
  setLevel: (source, level) => {
    const mix = { ...get().mix, [source]: { ...get().mix[source], level: clampLevel(source, level) } }
    saveMix(mix)
    set({ mix })
  },
  setMuted: (source, muted) => {
    const mix = { ...get().mix, [source]: { ...get().mix[source], muted } }
    saveMix(mix)
    set({ mix })
  },
}))

/** The gain a source plays at right now (0 when muted). */
export function mixGain(source: MixSource, mix: Mix = useAudioMixStore.getState().mix): number {
  const channel = mix[source]
  return channel.muted ? 0 : channel.level
}

/** Ramp time constant for a slider move - quick, but without a click in the sound. */
const RAMP_S = 0.02

const outputs = new Map<MixSource, { ctx: AudioContext; gain: GainNode }>()

/**
 * How this device's stereo output carries the sources (#481 step 1, docs/21 §9.2): all mixed (as
 * always), or split - click and announcements on one side, the track summed to mono on the other -
 * so a Y-cable or a stereo DI gives two signals: the click side to the in-ear mix, the track side to
 * FOH. For a device without an audio interface; with one, each source gets its own channel (§9.2).
 * Per device, like Mein Mix.
 */
export type OutputRouting = 'mixed' | 'click-left' | 'click-right'
export const OUTPUT_ROUTINGS: readonly OutputRouting[] = ['mixed', 'click-left', 'click-right']
const ROUTING_KEY = 'sb:audio:routing'

function loadRouting(): OutputRouting {
  try {
    const raw = localStorage.getItem(ROUTING_KEY)
    return OUTPUT_ROUTINGS.includes(raw as OutputRouting) ? (raw as OutputRouting) : 'mixed'
  } catch {
    return 'mixed'
  }
}

interface OutputRoutingState {
  routing: OutputRouting
  setRouting: (routing: OutputRouting) => void
}

export const useOutputRoutingStore = create<OutputRoutingState>((set) => ({
  routing: loadRouting(),
  setRouting: (routing) => {
    try {
      localStorage.setItem(ROUTING_KEY, routing)
    } catch {
      // Blocked storage: applies until the app is reloaded.
    }
    set({ routing })
  },
}))

/** Which side a source plays on when the output is split. */
export function sideOf(source: MixSource, routing: OutputRouting): 'left' | 'right' | null {
  if (routing === 'mixed') return null
  const clickSide = routing === 'click-left' ? 'left' : 'right'
  return source === 'track' ? (clickSide === 'left' ? 'right' : 'left') : clickSide
}

/** Per context: one mono bus per side into a two-channel merger - a stereo source (the track) is
 * summed to mono on the way in (Web Audio's own down-mix: (L+R)/2). */
const sides = new Map<AudioContext, Record<'left' | 'right', GainNode>>()

function sideBus(ctx: AudioContext, side: 'left' | 'right'): GainNode {
  let buses = sides.get(ctx)
  if (!buses) {
    const merger = ctx.createChannelMerger(2)
    merger.connect(ctx.destination)
    const bus = (channel: number) => {
      const node = ctx.createGain()
      node.channelCount = 1
      node.channelCountMode = 'explicit'
      node.channelInterpretation = 'speakers'
      node.connect(merger, 0, channel)
      return node
    }
    buses = { left: bus(0), right: bus(1) }
    sides.set(ctx, buses)
  }
  return buses[side]
}

/** Connects a source's gain to the output as the routing says - again on every change (`rewire`:
 * it is connected already and comes off first). */
function route(source: MixSource, ctx: AudioContext, gain: GainNode, routing: OutputRouting, rewire = false): void {
  if (rewire) gain.disconnect()
  const side = sideOf(source, routing)
  gain.connect(side ? sideBus(ctx, side) : ctx.destination)
}

/**
 * Where a source connects instead of `ctx.destination`: its own gain node on the shared
 * AudioContext, following the mix - and the output routing.
 */
export function sourceOutput(source: MixSource, ctx: AudioContext = getSharedAudioContext()): AudioNode {
  const existing = outputs.get(source)
  if (existing && existing.ctx === ctx) return existing.gain
  const gain = ctx.createGain()
  gain.gain.value = mixGain(source)
  route(source, ctx, gain, useOutputRoutingStore.getState().routing)
  outputs.set(source, { ctx, gain })
  return gain
}

useOutputRoutingStore.subscribe((state, before) => {
  if (state.routing === before.routing) return
  for (const [source, { ctx, gain }] of outputs) route(source, ctx, gain, state.routing, true)
})

/** Volume for an `<audio>` element playing the track (0..1). */
export function trackElementVolume(mix: Mix = useAudioMixStore.getState().mix): number {
  return Math.min(1, mixGain('track', mix))
}

useAudioMixStore.subscribe((state) => {
  for (const [source, { ctx, gain }] of outputs) gain.gain.setTargetAtTime(mixGain(source, state.mix), ctx.currentTime, RAMP_S)
})

/** Test-only. */
export function __resetAudioMixForTests(): void {
  outputs.clear()
  sides.clear()
  useOutputRoutingStore.setState({ routing: 'mixed' })
  useAudioMixStore.setState({ mix: { ...DEFAULT_MIX } })
}
