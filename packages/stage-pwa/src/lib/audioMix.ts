import { create } from 'zustand'
import { STEREO_FEEDS, type SideFeed, type SourceFeeds } from 'shared-types'
import { getSharedAudioContext } from './sharedAudioContext'
import { masterOutput } from './nativeOutput'

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
 * Where every source sits on this device's stereo output - the sound follows the map (#742,
 * docs/31 §0d): what each side gets from it (`SourceFeeds`: left on left and right on right as
 * always, the click on the left pin for the in-ear mix, the track summed on the right for FOH,
 * only the track's left side, ...) or null - silent, because the output the map names for it is
 * not the one Android plays on (never a wrong signal, docs/28). Written by `useOutputPlan`; not
 * stored, it follows the map and the output route.
 */
export type SourceSide = SourceFeeds | null
export type OutputPlan = Record<MixSource, SourceSide>
export const PLAIN_PLAN: OutputPlan = { track: STEREO_FEEDS, click: STEREO_FEEDS, voice: STEREO_FEEDS }

/** Two placements are the same (plans are rebuilt, compare by value). */
export const sameSide = (a: SourceSide, b: SourceSide): boolean => (a === null || b === null ? a === b : a.left === b.left && a.right === b.right)

interface OutputPlanState {
  plan: OutputPlan
  /** Practising "as in setup …" could not apply (device not placed, output missing): both ears. */
  fellBack: boolean
  setPlan: (plan: OutputPlan, fellBack?: boolean) => void
}

export const useOutputPlanStore = create<OutputPlanState>((set, get) => ({
  plan: PLAIN_PLAN,
  fellBack: false,
  setPlan: (plan, fellBack = false) => {
    const now = get()
    if (now.fellBack === fellBack && MIX_SOURCES.every((s) => sameSide(now.plan[s], plan[s]))) return
    set({ plan, fellBack })
  },
}))

/** Per context: one mono bus per side into a two-channel merger - a stereo source (the track) is
 * summed to mono on the way in (Web Audio's own down-mix: (L+R)/2). */
const sides = new Map<AudioContext, Record<'left' | 'right', GainNode>>()

function sideBus(ctx: AudioContext, side: 'left' | 'right'): GainNode {
  let buses = sides.get(ctx)
  if (!buses) {
    const merger = ctx.createChannelMerger(2)
    merger.connect(masterOutput(ctx))
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

/** Connects a source's gain to the output as the plan says - again on every change (`rewire`:
 * it is connected already and comes off first). A silent source stays unconnected. Left on left
 * and right on right goes straight to the output as always; otherwise each side's bus gets the
 * sum (`mix`, the bus's own down-mix) or one channel of the source through a splitter. */
function route(ctx: AudioContext, gain: GainNode, side: SourceSide, rewire = false): void {
  if (rewire) gain.disconnect()
  if (side === null) return
  if (side.left === 'L' && side.right === 'R') {
    gain.connect(masterOutput(ctx))
    return
  }
  let splitter: ChannelSplitterNode | null = null
  const feed = (to: 'left' | 'right', what: SideFeed) => {
    if (what === null) return
    if (what === 'mix') return gain.connect(sideBus(ctx, to))
    if (!splitter) {
      splitter = ctx.createChannelSplitter(2)
      gain.connect(splitter)
    }
    splitter.connect(sideBus(ctx, to), what === 'L' ? 0 : 1)
  }
  feed('left', side.left)
  feed('right', side.right)
}

/**
 * Where a source connects instead of `ctx.destination`: its own gain node on the shared
 * AudioContext, following the mix - and the output plan.
 */
export function sourceOutput(source: MixSource, ctx: AudioContext = getSharedAudioContext()): AudioNode {
  const existing = outputs.get(source)
  if (existing && existing.ctx === ctx) return existing.gain
  const gain = ctx.createGain()
  gain.gain.value = mixGain(source)
  route(ctx, gain, useOutputPlanStore.getState().plan[source])
  outputs.set(source, { ctx, gain })
  return gain
}

useOutputPlanStore.subscribe((state, before) => {
  for (const [source, { ctx, gain }] of outputs) if (!sameSide(state.plan[source], before.plan[source])) route(ctx, gain, state.plan[source], true)
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
  useOutputPlanStore.setState({ plan: PLAIN_PLAN, fellBack: false })
  useAudioMixStore.setState({ mix: { ...DEFAULT_MIX } })
}
