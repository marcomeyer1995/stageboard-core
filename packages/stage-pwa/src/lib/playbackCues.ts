import { PLAYBACK_CUE_TARGET, PLAYBACK_CUE_TYPE, type ShowCue } from 'shared-types'
import type { ClickTimeline } from './beatGrid'

/** Click and announcements off/on, and the backing track's level, at points in the song (#485) -
 * see `PLAYBACK_CUE_TARGET`. */

export type Switch = 'on' | 'off'

export type FadeUnit = 'ms' | 'beats' | 'bars'

/** The backing track's level from a cue on (#485): `db` relative to the track as uploaded (0 = as
 * is), null = muted; reached over `fade` (none = at once). */
export interface TrackLevel {
  db: number | null
  fade?: { amount: number; unit: FadeUnit }
}

export interface PlaybackSwitches {
  click?: Switch
  voice?: Switch
  track?: TrackLevel
}

export function isPlaybackCue(cue: Pick<ShowCue, 'targetLogicalDeviceId'>): boolean {
  return cue.targetLogicalDeviceId === PLAYBACK_CUE_TARGET
}

function trackLevelOf(value: unknown): TrackLevel | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as { db?: unknown; fade?: { amount?: unknown; unit?: unknown } }
  const db = v.db === null ? null : typeof v.db === 'number' && Number.isFinite(v.db) ? v.db : undefined
  if (db === undefined) return undefined
  const fade = v.fade
  const unit = fade?.unit === 'ms' || fade?.unit === 'beats' || fade?.unit === 'bars' ? fade.unit : null
  const amount = typeof fade?.amount === 'number' && fade.amount > 0 ? fade.amount : null
  return unit && amount ? { db, fade: { amount, unit } } : { db }
}

export function playbackSwitches(cue: Pick<ShowCue, 'payload'>): PlaybackSwitches {
  const sw = (v: unknown): Switch | undefined => (v === 'on' || v === 'off' ? v : undefined)
  return { click: sw(cue.payload?.click), voice: sw(cue.payload?.voice), track: trackLevelOf(cue.payload?.track) }
}

export function playbackCueContent(switches: PlaybackSwitches): Omit<ShowCue, 'id' | 'timeMs'> {
  const payload: Record<string, unknown> = {}
  if (switches.click) payload.click = switches.click
  if (switches.voice) payload.voice = switches.voice
  if (switches.track) payload.track = switches.track.fade ? { db: switches.track.db, fade: switches.track.fade } : { db: switches.track.db }
  return { targetLogicalDeviceId: PLAYBACK_CUE_TARGET, type: PLAYBACK_CUE_TYPE, payload }
}

const FADE_UNIT_LABEL: Record<FadeUnit, (n: number) => string> = {
  ms: (n) => `${n} ms`,
  beats: (n) => `${n} ${n === 1 ? 'Schlag' : 'Schlägen'}`,
  bars: (n) => `${n} ${n === 1 ? 'Takt' : 'Takten'}`,
}

/** "Track −6 dB in 2 Takten", "Track stumm" - for the cue lane and lists. */
export function trackLevelLabel(level: TrackLevel): string {
  const what = level.db === null ? 'stumm' : level.db === 0 ? 'normal' : `${level.db > 0 ? '+' : '−'}${Math.abs(level.db)} dB`
  return `Track ${what}${level.fade ? ` in ${FADE_UNIT_LABEL[level.fade.unit](level.fade.amount)}` : ''}`
}

/** "Klick aus · Ansagen an · Track stumm" - for the cue lane. */
export function playbackCueLabel(cue: Pick<ShowCue, 'payload'>): string {
  const { click, voice, track } = playbackSwitches(cue)
  const parts = [click && `Klick ${click === 'on' ? 'an' : 'aus'}`, voice && `Ansagen ${voice === 'on' ? 'an' : 'aus'}`, track && trackLevelLabel(track)].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Wiedergabe'
}

/** A cue counts from this much before its time - a cue placed on a bar line also covers the
 * downbeat itself, even a few ms off. */
const AT_MS = 5

/**
 * Whether click and announcements sound at song time `timeMs`: both on at the start, each
 * switched by the latest playback cue up to then that names it.
 */
export function playbackStateAt(cues: readonly ShowCue[], timeMs: number): { click: boolean; voice: boolean } {
  let click = true
  let voice = true
  for (const cue of [...cues].filter(isPlaybackCue).sort((a, b) => a.timeMs - b.timeMs)) {
    if (cue.timeMs > timeMs + AT_MS) break
    const sw = playbackSwitches(cue)
    if (sw.click) click = sw.click === 'on'
    if (sw.voice) voice = sw.voice === 'on'
  }
  return { click, voice }
}

/** `playbackStateAt` as a fast lookup for the click engine, which asks for every beat. */
export function playbackLookup(cues: readonly ShowCue[]): (timeMs: number) => { click: boolean; voice: boolean } {
  const own = cues.filter(isPlaybackCue)
  if (own.length === 0) return () => ({ click: true, voice: true })
  return (timeMs) => playbackStateAt(own, timeMs)
}

/** One point of the track's level curve: the gain (linear, 1 = as uploaded) at a song time. */
export interface LevelPoint {
  timeMs: number
  gain: number
}

/** Even an "at once" change takes this long - a jump in level clicks. */
export const MIN_LEVEL_RAMP_MS = 10

export const dbToGain = (db: number | null): number => (db === null ? 0 : Math.pow(10, db / 20))

/** How long a fade is from `atMs` on, in the song's own grid (beats and bars follow its tempo there). */
export function fadeDurationMs(fade: TrackLevel['fade'], atMs: number, timeline: ClickTimeline | null): number {
  if (!fade) return 0
  if (fade.unit === 'ms' || !timeline) return fade.unit === 'ms' ? fade.amount : fade.amount * (fade.unit === 'bars' ? 2000 : 500)
  const beat = timeline.beatAtOrBefore(atMs)
  const perBar = Number(timeline.timeSignatureAt(beat).split('/')[0]) || 4
  const beats = fade.amount * (fade.unit === 'bars' ? perBar : 1)
  // From the cue's own position between two beats, so a fade on a bar line ends on one.
  const into = (atMs - timeline.timeOfBeat(beat)) / Math.max(1, timeline.periodAfter(beat))
  const end = beat + into + beats
  const whole = Math.floor(end)
  return timeline.timeOfBeat(whole) + (end - whole) * timeline.periodAfter(whole) - atMs
}

/** The level at `timeMs` on a curve (linear between points; 1 before the first). */
export function levelAt(curve: readonly LevelPoint[], timeMs: number): number {
  if (curve.length === 0 || timeMs <= curve[0]!.timeMs) return curve[0]?.gain ?? 1
  for (let i = 1; i < curve.length; i++) {
    const b = curve[i]!
    if (timeMs <= b.timeMs) {
      const a = curve[i - 1]!
      return b.timeMs === a.timeMs ? b.gain : a.gain + ((b.gain - a.gain) * (timeMs - a.timeMs)) / (b.timeMs - a.timeMs)
    }
  }
  return curve[curve.length - 1]!.gain
}

/**
 * The track's level over the song from its playback cues (#485): as uploaded at the start, then
 * each track cue ramps linearly from the level at its time to its own over its fade. A cue that
 * comes while a fade still runs takes over from the level reached. Song time, so a seek or a
 * section jump lands on the right level by itself. Empty: no track cue, the level never changes.
 */
export function trackLevelCurve(cues: readonly ShowCue[], timeline: ClickTimeline | null): LevelPoint[] {
  const own = cues
    .filter(isPlaybackCue)
    .map((cue) => ({ timeMs: cue.timeMs, level: playbackSwitches(cue).track }))
    .filter((c): c is { timeMs: number; level: TrackLevel } => c.level !== undefined)
    .sort((a, b) => a.timeMs - b.timeMs)
  if (own.length === 0) return []
  let curve: LevelPoint[] = [{ timeMs: 0, gain: 1 }]
  for (const { timeMs, level } of own) {
    const from = levelAt(curve, timeMs)
    // A later cue cuts a fade short: drop what lies beyond its start.
    curve = [...curve.filter((p) => p.timeMs < timeMs), { timeMs, gain: from }]
    const duration = Math.max(MIN_LEVEL_RAMP_MS, fadeDurationMs(level.fade, timeMs, timeline))
    curve.push({ timeMs: timeMs + duration, gain: dbToGain(level.db) })
  }
  return curve
}
