import { z } from 'zod'

/**
 * A capability is the vocabulary that binds a plugin to a widget: a plugin declares
 * what it can do, a widget declares what it needs. Deliberately an open string type -
 * community plugins from their own repositories (see docs/01) bring their own.
 */
export const CapabilityIdSchema = z.string().min(1)
export type CapabilityId = z.infer<typeof CapabilityIdSchema>

/** The capabilities StageBoard's own widgets ask for. */
export const CAPABILITIES = {
  /** Digital mixer control - IEM "More Me" faders. */
  mixer: 'mixer',
  /** DMX / lighting desk cues. */
  lighting: 'lighting',
  /** Generic MIDI/OSC show cue sending. */
  showControl: 'show-control',
  /** Foot switch / MIDI input on the tablet itself (WebMIDI). */
  midiInput: 'midi-input',
  /** Backing track playback. */
  audioPlayback: 'audio-playback',
  /** Automated backups (docs/02 backup strategies). */
  backup: 'backup',
} as const satisfies Record<string, CapabilityId>
