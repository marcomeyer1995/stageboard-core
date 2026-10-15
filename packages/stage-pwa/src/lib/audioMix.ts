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
 * Where a source connects instead of `ctx.destination`: its own gain node on the shared
 * AudioContext, following the mix.
 */
export function sourceOutput(source: MixSource, ctx: AudioContext = getSharedAudioContext()): AudioNode {
  const existing = outputs.get(source)
  if (existing && existing.ctx === ctx) return existing.gain
  const gain = ctx.createGain()
  gain.gain.value = mixGain(source)
  gain.connect(ctx.destination)
  outputs.set(source, { ctx, gain })
  return gain
}

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
  useAudioMixStore.setState({ mix: { ...DEFAULT_MIX } })
}
