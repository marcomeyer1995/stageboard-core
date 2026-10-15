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
  /** Synthesized click/metronome sound (#25), routable to a tablet's own speaker/IEM or, once
   * a hardware plugin provides it, external gear. */
  clickTrack: 'click-track',
  /** Automated backups (docs/02 backup strategies). */
  backup: 'backup',
  /** Automatic BPM + beat detection for a song's backing track ("Track analysieren", #25
   * follow-up) - optional; the built-in detector and setting the click grid by hand in the
   * timeline always work without any plugin installed. */
  audioAnalysis: 'audio-analysis',
  /** MIDI beat clock (#478): 24 ticks per beat from the click grid, Start/Stop/Continue and Song
   * Position Pointer, sent to any MIDI output - a generic "MIDI-Clock" device, bound to the port
   * of the gear that should follow the song tempo (Kemper delay, RC-500 loop, drum machine). */
  midiClock: 'midi-clock',
  /** Speech clips for spoken announcements (#63), generated on the Stage-Server (Piper). */
  speechSynthesis: 'speech-synthesis',
  /** Splits a track into stems (drums, bass, vocals ...) on the Stage-Server (#9). */
  stemSeparation: 'stem-separation',
  /** Spoken section announcements in the in-ears (#63): "Chorus", "Bridge" a bar before the part,
   * played on the click's Web Audio clock - an audio source like click and track. */
  sectionAnnouncements: 'section-announcements',
} as const satisfies Record<string, CapabilityId>
