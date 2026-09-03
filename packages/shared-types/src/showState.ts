import { z } from 'zod'

/** Playback transport for the currently active setlist entry (#13) - `stopped` doubles as the
 * "armed" state (Reset always returns here with `playbackAccumulatedMs` zeroed). Deliberately
 * uniform whether or not a band has an `audio-playback` plugin installed: for a song with no
 * timecodes at all (docs/04 §4's "No-Timecode" mode), this still tracks "are we actively
 * performing this entry right now" for ShowLog purposes, even though nothing reads it to drive
 * a scrolling clock. */
export const PlaybackStatusSchema = z.enum(['playing', 'paused', 'stopped'])
export type PlaybackStatus = z.infer<typeof PlaybackStatusSchema>

/**
 * Singleton, per-workspace synced doc: which setlist/song is currently active,
 * and who (which tablet) holds the Master-Token. All tablets in a workspace
 * read this; only the current token holder is expected to write it.
 */
export const ShowStateSchema = z.object({
  activeSetlistId: z.string().nullable(),
  /** The current SetlistEntry's id, not a bare songId - a songId alone can't tell which
   * occurrence is current when the same song appears twice in a setlist (e.g. full version
   * then a shortened encore). With no active setlist, computeQueue synthesizes one entry per
   * catalog song whose id equals the songId, so this still just works. */
  activeEntryId: z.string().nullable(),
  /** When `activeEntryId` last became current - the `song-played` log event's `at` timestamp.
   * Null whenever the entry is "unarmed" (see PlaybackStatusSchema's doc comment): Stop/Reset
   * clear it back to null, so a later Play on the same entry starts a genuinely new take with
   * its own fresh log entry rather than silently extending the previous one. */
  activeEntryStartedAt: z.number().nullable(),
  masterHolderId: z.string().nullable(),
  masterClaimedAt: z.number().nullable(),
  playbackStatus: PlaybackStatusSchema,
  /** Wall-clock timestamp the current `playing` run began - null while paused/stopped. Readers
   * on other tablets add their own clockSync.ts offset (`getServerTime()`) rather than trusting
   * this device's raw clock, so every tablet computes the same elapsed time. */
  playbackStartedAt: z.number().nullable(),
  /** Active (unpaused) ms accumulated for the current entry's play-through across any number of
   * pause/resume cycles - this, not wall-clock `endedAt - at`, is what excludes paused/stopped
   * time from a song's logged duration (#13). */
  playbackAccumulatedMs: z.number(),
  /** A "show" is every ShowLog event sharing one id - see showLog.ts. Null until the first
   * entry of a session is activated. */
  currentShowId: z.string().nullable(),
  /** When an entry was last activated - shouldStartNewShow's gap check (showLogTracking.ts)
   * uses this to decide whether enough idle time passed to start a fresh `show` instead of
   * continuing the current one. */
  lastActivityAt: z.number().nullable(),
})
export type ShowState = z.infer<typeof ShowStateSchema>

export const DEFAULT_SHOW_STATE: ShowState = {
  activeSetlistId: null,
  activeEntryId: null,
  activeEntryStartedAt: null,
  masterHolderId: null,
  masterClaimedAt: null,
  playbackStatus: 'stopped',
  playbackStartedAt: null,
  playbackAccumulatedMs: 0,
  currentShowId: null,
  lastActivityAt: null,
}
