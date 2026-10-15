import { create } from 'zustand'

/**
 * Which stems play on this device and how (docs/22 §3): per song variant, whether its stems play
 * instead of the track, which stem set, and per stem a level, Stumm and Solo. Per device
 * (localStorage) - whoever practices here sets it for themselves; the band-wide balance between
 * stems for the Gig (docs/22 §4) is a later step.
 */

export interface StemChannel {
  level: number
  muted: boolean
  solo: boolean
}

export interface StemMixSettings {
  on: boolean
  /** Stem set key (stems.ts `StemSet.key`); null = the default set. */
  set: string | null
  stems: Record<string, StemChannel>
}

export const DEFAULT_CHANNEL: StemChannel = {
  level: 1,
  muted: false,
  solo: false,
}
export const DEFAULT_STEM_MIX: StemMixSettings = {
  on: false,
  set: null,
  stems: {},
}
/** Stems top out at full level - they are the track, split up. */
export const STEM_MAX_LEVEL = 1

const STORAGE_KEY = 'sb:stems:mix'

type ByVariant = Record<string, StemMixSettings>

function parseChannel(raw: unknown): StemChannel {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CHANNEL }
  const { level, muted, solo } = raw as Record<string, unknown>
  return {
    level: typeof level === 'number' && Number.isFinite(level) ? Math.min(STEM_MAX_LEVEL, Math.max(0, level)) : 1,
    muted: muted === true,
    solo: solo === true,
  }
}

export function parseStemMix(raw: unknown): ByVariant {
  const out: ByVariant = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [variantId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const { on, set, stems } = value as Record<string, unknown>
    const channels: Record<string, StemChannel> = {}
    if (stems && typeof stems === 'object') for (const [id, channel] of Object.entries(stems)) channels[id] = parseChannel(channel)
    out[variantId] = {
      on: on === true,
      set: typeof set === 'string' ? set : null,
      stems: channels,
    }
  }
  return out
}

function load(): ByVariant {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return parseStemMix(raw ? JSON.parse(raw) : null)
  } catch {
    return {}
  }
}

function save(byVariant: ByVariant): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byVariant))
  } catch {
    // Blocked storage: the settings apply until the app is reloaded.
  }
}

interface StemMixState {
  byVariant: ByVariant
  setOn: (variantId: string, on: boolean) => void
  setSet: (variantId: string, set: string) => void
  setChannel: (variantId: string, stemId: string, patch: Partial<StemChannel>) => void
}

export const useStemMixStore = create<StemMixState>((set, get) => {
  const update = (variantId: string, change: (current: StemMixSettings) => StemMixSettings) => {
    const byVariant = {
      ...get().byVariant,
      [variantId]: change(get().byVariant[variantId] ?? DEFAULT_STEM_MIX),
    }
    save(byVariant)
    set({ byVariant })
  }
  return {
    byVariant: load(),
    setOn: (variantId, on) => update(variantId, (current) => ({ ...current, on })),
    setSet: (variantId, key) => update(variantId, (current) => ({ ...current, set: key })),
    setChannel: (variantId, stemId, patch) =>
      update(variantId, (current) => ({
        ...current,
        stems: {
          ...current.stems,
          [stemId]: { ...(current.stems[stemId] ?? DEFAULT_CHANNEL), ...patch },
        },
      })),
  }
})

export function stemMixFor(variantId: string | null | undefined, byVariant: ByVariant): StemMixSettings {
  return (variantId && byVariant[variantId]) || DEFAULT_STEM_MIX
}

export function channelOf(settings: StemMixSettings, stemId: string): StemChannel {
  return settings.stems[stemId] ?? DEFAULT_CHANNEL
}

/** The gain each stem plays at: its level, 0 when muted - and when any stem is soloed, only the
 * soloed ones are heard (a muted solo stays silent). */
export function stemGains(settings: StemMixSettings, stemIds: readonly string[]): Map<string, number> {
  const anySolo = stemIds.some((id) => channelOf(settings, id).solo)
  return new Map(
    stemIds.map((id) => {
      const channel = channelOf(settings, id)
      const audible = !channel.muted && (!anySolo || channel.solo)
      return [id, audible ? channel.level : 0]
    }),
  )
}

/** Test-only. */
export function __resetStemMixForTests(): void {
  useStemMixStore.setState({ byVariant: {} })
}
