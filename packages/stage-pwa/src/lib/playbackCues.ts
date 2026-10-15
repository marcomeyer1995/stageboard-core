import { PLAYBACK_CUE_TARGET, PLAYBACK_CUE_TYPE, type ShowCue } from 'shared-types'

/** Click and announcements off/on at points in the song (#485) - see `PLAYBACK_CUE_TARGET`. */

export type Switch = 'on' | 'off'
export interface PlaybackSwitches {
  click?: Switch
  voice?: Switch
}

export function isPlaybackCue(cue: Pick<ShowCue, 'targetLogicalDeviceId'>): boolean {
  return cue.targetLogicalDeviceId === PLAYBACK_CUE_TARGET
}

export function playbackSwitches(cue: Pick<ShowCue, 'payload'>): PlaybackSwitches {
  const sw = (v: unknown): Switch | undefined => (v === 'on' || v === 'off' ? v : undefined)
  return { click: sw(cue.payload?.click), voice: sw(cue.payload?.voice) }
}

export function playbackCueContent(switches: PlaybackSwitches): Omit<ShowCue, 'id' | 'timeMs'> {
  const payload: Record<string, string> = {}
  if (switches.click) payload.click = switches.click
  if (switches.voice) payload.voice = switches.voice
  return { targetLogicalDeviceId: PLAYBACK_CUE_TARGET, type: PLAYBACK_CUE_TYPE, payload }
}

/** "Klick aus · Ansagen an" - for the cue lane. */
export function playbackCueLabel(cue: Pick<ShowCue, 'payload'>): string {
  const { click, voice } = playbackSwitches(cue)
  const parts = [click && `Klick ${click === 'on' ? 'an' : 'aus'}`, voice && `Ansagen ${voice === 'on' ? 'an' : 'aus'}`].filter(Boolean)
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
