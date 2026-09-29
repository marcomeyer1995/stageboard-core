import type { ShowCue } from 'shared-types'
import { randomId } from './id'

/**
 * Cues on the timeline (docs/14 §7, phase 3): pure edits of a variant's cue list - kept sorted by
 * time, never before 0:00. The cue's content (target device, type, payload) is edited through the
 * same fields as the cue list (`CueListEditor.tsx`), see `parseCuePayload`.
 */

const byTime = (a: ShowCue, b: ShowCue) => a.timeMs - b.timeMs

export function addCue(cues: readonly ShowCue[], cue: Omit<ShowCue, 'id'>): { cues: ShowCue[]; id: string } {
  const id = randomId()
  return { cues: [...cues, { ...cue, id, timeMs: Math.max(0, Math.round(cue.timeMs)) }].sort(byTime), id }
}

export function moveCue(cues: readonly ShowCue[], id: string, timeMs: number): ShowCue[] {
  return cues.map((c) => (c.id === id ? { ...c, timeMs: Math.max(0, Math.round(timeMs)) } : c)).sort(byTime)
}

export function updateCue(cues: readonly ShowCue[], id: string, patch: Partial<Omit<ShowCue, 'id' | 'timeMs'>>): ShowCue[] {
  return cues.map((c) => (c.id === id ? { ...c, ...patch } : c))
}

export function removeCue(cues: readonly ShowCue[], id: string): ShowCue[] {
  return cues.filter((c) => c.id !== id)
}

/** Recorded cues (Cue-Recorder) merged into the list. */
export function mergeCues(cues: readonly ShowCue[], recorded: readonly ShowCue[]): ShowCue[] {
  return [...cues, ...recorded].sort(byTime)
}

/** The optional JSON payload of the cue form: empty = none, an object = the payload, anything
 * else = an error message. */
export function parseCuePayload(text: string): { payload: Record<string, unknown> | undefined } | { error: string } {
  if (!text.trim()) return { payload: undefined }
  try {
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { error: 'Payload muss ein JSON-Objekt sein, z.B. {"slot": 3}' }
    return { payload: value as Record<string, unknown> }
  } catch {
    return { error: 'Ungültiges JSON' }
  }
}
