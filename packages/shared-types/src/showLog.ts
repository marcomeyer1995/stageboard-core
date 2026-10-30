import { z } from 'zod'

/**
 * A capability's available/degraded/missing status, duplicated here rather than shared
 * with packages/stage-pwa/src/lib/capabilities.ts's CapabilityStatus type (frontend-only,
 * not worth relocating for three literal strings unlikely to drift).
 */
const CapabilityStatusValueSchema = z.enum(['available', 'degraded', 'missing'])

/** One editor analysis path scored against the Rig-Check's ground truth (#464, docs/24 §6). */
export const RigCheckPathScoreSchema = z.object({
  bpm: z.number().nullable(),
  gridPoints: z.number().int().nonnegative(),
  sections: z.array(
    z.object({
      name: z.string(),
      label: z.string(),
      beats: z.number().int().nonnegative(),
      hitRate: z.number(),
      meanAbsMs: z.number(),
      maxAbsMs: z.number(),
      slipRate: z.number(),
      knownLimit: z.enum(['change-in-bar', 'silent']).nullable(),
    }),
  ),
})
export type RigCheckPathScore = z.infer<typeof RigCheckPathScoreSchema>

/**
 * One event in a show's history. A "show" is simply every event sharing one `showId` -
 * there is no separate summary document, so there's nothing to keep in sync.
 *
 * Detection (which show is running, whether a song stayed active long enough to count as
 * "played") happens client-side as a direct consequence of the Master-Token holder's own
 * transport actions (play/pause/stop/advance - see stage-pwa's queue.ts), gated the same way
 * every other ShowState write is, so only one tablet ever writes these at a time.
 * Capability-changed detection is the one part that's still a reactive watch over time rather
 * than a discrete action (see stage-pwa's useShowLogTracker.ts), for the same reason and the
 * same trust gate. `note` events are one exception: any device can add one, not just the
 * master. `cue-fired` (#8) is the other: written by the device that sent the cue - its id is the
 * same on every device (show + play-through + cue), so copies merge.
 */
export const ShowLogEventSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('show-started'),
    at: z.number().int().nonnegative(),
  }),
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('song-played'),
    /** When the song became active. */
    at: z.number().int().nonnegative(),
    /** When the play-through ended (Stop, Reset, or the queue advancing past it). */
    endedAt: z.number().int().nonnegative(),
    songId: z.string().min(1),
    /** Denormalized so the report still reads right if the song is later renamed/deleted. */
    songTitle: z.string().min(1),
    /** Active (unpaused) duration, per ShowState.playbackStatus (#13) - excludes any time the
     * song sat paused (stage banter, retuning), unlike the wider `endedAt - at` span. This is
     * the duration the Nachbericht should display. */
    activeMs: z.number().int().nonnegative(),
    /** The song's planned length when it was played - track or variant length (#64: planned vs.
     * actual). Absent when unknown, and on events from before 2026-10-22. */
    plannedMs: z.number().int().nonnegative().optional(),
    /** The pause the setlist planned after this song until the next one starts - its pause between
     * songs, a transition item's length, 0 for "seamless" (#64; festivalClock's rules). Absent
     * without a next entry, and on older events. */
    plannedPauseAfterMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('capability-changed'),
    at: z.number().int().nonnegative(),
    capability: z.string().min(1),
    from: CapabilityStatusValueSchema,
    to: CapabilityStatusValueSchema,
  }),
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('cue-fired'),
    /** When the cue went out. */
    at: z.number().int().nonnegative(),
    songId: z.string().min(1),
    songTitle: z.string().min(1),
    cueId: z.string().min(1),
    /** The variant the cue belongs to (#8: "Cue anpassen" in the Nachbericht edits it there).
     * Absent on events from before 2026-10-22 - then the song's variant holding `cueId`. */
    variantId: z.string().min(1).optional(),
    /** The cue's command, e.g. `kemper.selectRig`. */
    cueType: z.string().min(1),
    /** Who it went to - the Logical Device's name (or its id when it no longer exists). */
    target: z.string().min(1),
    ok: z.boolean(),
    /** Why it failed (device gone, no output, the device's own error). */
    message: z.string().max(300).optional(),
  }),
  /** A Rig-Check run (#464, docs/24 §5) - written by the master at Vorbereiten and updated at
   * Start and at the end. Its `showId` is the run's own show, which marks that show as a
   * Rig-Check in the Nachbericht. `previous`: what the show was on before, restored at the end. */
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('rig-check-run'),
    /** When it was prepared. */
    at: z.number().int().nonnegative(),
    kind: z.enum(['quick', 'full']),
    /** Generator version (rigCheckSong.ts) - results of different versions aren't comparable. */
    version: z.number().int().positive(),
    startedAt: z.number().int().nonnegative().optional(),
    endedAt: z.number().int().nonnegative().optional(),
    /** Ended with Abbrechen before or while it played. */
    cancelled: z.boolean().optional(),
    /** The analysis check of a full run (docs/24 §6, rigCheckAnalysis.ts), per editor path. */
    analysis: z
      .object({
        sampleRate: z.number().int().positive(),
        detect: RigCheckPathScoreSchema.nullable(),
        refine: RigCheckPathScoreSchema.nullable(),
      })
      .optional(),
    previous: z
      .object({
        activeSetlistId: z.string().nullable(),
        activeEntryId: z.string().nullable(),
        currentShowId: z.string().nullable(),
        lastActivityAt: z.number().nullable(),
      })
      .optional(),
  }),
  /** One device's part of a Rig-Check run (#464): written by that device, one id per run and
   * device - its state while the run is open, then the band's eye-and-ear verdict. */
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('rig-check-device'),
    /** When this device last updated it. */
    at: z.number().int().nonnegative(),
    deviceId: z.string().min(1),
    deviceName: z.string().min(1).max(120),
    /** 'practice': in Solo Üben - it does not follow the run. */
    mode: z.enum(['gig', 'practice']),
    trackReady: z.boolean(),
    /** This device's clock against the Stage-Server's, and how much it varies (clockSync.ts). */
    clockOffsetMs: z.number().nullable(),
    clockJitterMs: z.number().nullable(),
    /** Speaker, headphones, Bluetooth … (useAudioRouteStore) and the stored output latency for it. */
    audioRoute: z.string().max(40),
    outputLatencyMs: z.number().nullable(),
    verdict: z.enum(['ok', 'problem']).nullable(),
    note: z.string().max(300).optional(),
  }),
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('note'),
    at: z.number().int().nonnegative(),
    text: z.string().min(1),
    authorProfileId: z.string().nullable(),
  }),
  // --- #673: everything that happened, for a Nachbericht of what happened when and how. Written
  // by the master (every one of these is a master action), except `flash` (by its sender). ---
  /** A transport action on the current song: Play, Pause, Stop, Reset, or the track ran out. */
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('playback'),
    at: z.number().int().nonnegative(),
    action: z.enum(['play', 'pause', 'stop', 'reset', 'track-end']),
    songId: z.string().nullable(),
    songTitle: z.string(),
    /** Where in the song it happened (song time, ms). */
    positionMs: z.number().int(),
  }),
  /** A section jump queued or called off, or a section repeated / released (#479). */
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('section'),
    at: z.number().int().nonnegative(),
    action: z.enum(['jump', 'jump-cancelled', 'repeat', 'repeat-end']),
    songId: z.string().nullable(),
    songTitle: z.string(),
    /** The section it leaves / repeats, and where it goes (labels as in the song). */
    fromLabel: z.string().optional(),
    toLabel: z.string().optional(),
    /** Song time where the jump happens and where it lands. */
    fromMs: z.number().int().optional(),
    toMs: z.number().int().optional(),
  }),
  /** Another device took the Master-Token. */
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('master'),
    at: z.number().int().nonnegative(),
    deviceName: z.string(),
    profileName: z.string().nullable(),
    forced: z.boolean(),
  }),
  /** A Ready Check started, or ended with who was ready and who was missing (#60). */
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('ready-check'),
    at: z.number().int().nonnegative(),
    action: z.enum(['started', 'ended']),
    ready: z.array(z.string()).optional(),
    missing: z.array(z.string()).optional(),
  }),
  /** Something about how the song sounds changed live: tempo correction, track, click. */
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('sound'),
    at: z.number().int().nonnegative(),
    what: z.enum(['tempo', 'track', 'click', 'click-extend']),
    songId: z.string().nullable(),
    songTitle: z.string(),
    /** The new value: the percent ("3"), the track's name ('' = the setlist's), 'on' / 'off' ('' =
     * the song's own), the bars added. */
    value: z.string(),
  }),
  /** A flash message sent to the band or some of it. */
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('flash'),
    at: z.number().int().nonnegative(),
    text: z.string().min(1),
    from: z.string().nullable(),
    /** Names it went to; empty = everyone. */
    to: z.array(z.string()),
  }),
  /** An announcement / pause / section heading between songs, with how long it really took. */
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('item-played'),
    at: z.number().int().nonnegative(),
    endedAt: z.number().int().nonnegative(),
    title: z.string(),
    style: z.enum(['announcement', 'heading']),
    activeMs: z.number().int().nonnegative(),
    plannedMs: z.number().int().nonnegative().optional(),
  }),
])
export type ShowLogEvent = z.infer<typeof ShowLogEventSchema>

/**
 * What a band records for its Nachbericht (#673): one switch per category, all on unless an admin
 * switched one off. Song plays also feed "Geprobt" in the Bibliothek.
 */
export const SHOW_LOG_CATEGORIES = ['songs', 'playback', 'sections', 'cues', 'devices', 'master', 'sound', 'messages', 'between'] as const
export type ShowLogCategory = (typeof SHOW_LOG_CATEGORIES)[number]

/** The category an event belongs to - for the setting and the Nachbericht's filter. Show start and
 * Rig-Check results always count (they hold the show together). */
export function showLogCategory(event: Pick<ShowLogEvent, 'type'>): ShowLogCategory | null {
  switch (event.type) {
    case 'song-played':
      return 'songs'
    case 'playback':
      return 'playback'
    case 'section':
      return 'sections'
    case 'cue-fired':
      return 'cues'
    case 'capability-changed':
      return 'devices'
    case 'master':
    case 'ready-check':
      return 'master'
    case 'sound':
      return 'sound'
    case 'flash':
    case 'note':
      return 'messages'
    case 'item-played':
      return 'between'
    default:
      return null
  }
}
