import { getTrack } from './songVariantsDb'

export interface LocalAudioResult {
  status: 'ok' | 'error'
  message?: string
}

/**
 * Plays a backing track straight out of this tablet's own speakers/headphones - no
 * Stage-Server or audio interface involved. The Practice-mode counterpart to
 * `triggerShowControl.ts`'s HTTP call to a Stage-Server plugin, deliberately kept as its own
 * standalone, reusable module rather than private to any one widget: once #10 (Logical
 * Devices & Hardware Setup Profiles) adds a way to bind *this specific tablet* as the live
 * audio-output target for a Gig-mode show, that path can call these same functions rather than
 * duplicating them - see ShowTransportWidget.tsx's doc comment.
 *
 * A single, lazily-created `<audio>` element is reused across calls rather than one per
 * load - so pause/resume/stop always act on whatever is actually loaded right now, and the
 * browser only ever has one local playback stream going for this widget.
 */
let audioEl: HTMLAudioElement | null = null
let currentObjectUrl: string | null = null

function getAudioEl(): HTMLAudioElement {
  if (!audioEl) audioEl = new Audio()
  return audioEl
}

/** Loads a track's audio attachment and cues it up at `atMs` (0 for a fresh/unplayed entry -
 * callers pass the current synced position so a device that becomes the claimed output
 * *mid-song*, e.g. a hardware rebind or a late join, starts from the right place instead of
 * the beginning - found live, 2026-09-10). Revokes the previous object URL first - PouchDB
 * attachments are fetched as Blobs, and object URLs otherwise leak for the lifetime of the
 * page. */
export async function loadLocalTrack(variantId: string, trackId: string, atMs: number): Promise<LocalAudioResult> {
  const blob = await getTrack(variantId, trackId)
  if (!blob) return { status: 'error', message: 'Kein Track gefunden' }

  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl)
  currentObjectUrl = URL.createObjectURL(blob)

  const audio = getAudioEl()
  audio.src = currentObjectUrl
  audio.currentTime = atMs / 1000
  return { status: 'ok' }
}

/** Seeks to `atMs` before starting - without this, resuming played from wherever the element
 * happened to be cued (stale from a previous song, or the load-time position even if paused
 * partway through), not the actual synced position (found live, 2026-09-10 alongside the
 * missing sync fix below). */
export function playLocalTrack(atMs: number): void {
  const audio = getAudioEl()
  audio.currentTime = atMs / 1000
  // play() returns a promise that rejects with AbortError if pause() interrupts it before it
  // resolves (e.g. a quick double-tap) - expected, not a bug (same as BackingTrackPlayerWidget
  // and TapToSync's identical pattern).
  void audio.play().catch(() => {})
}

export function pauseLocalTrack(): void {
  getAudioEl().pause()
}

/** How far `audio.currentTime` may drift from the synced position before we forcibly correct
 * it - large enough that normal, inaudible native-`<audio>` clock jitter never triggers a seek
 * (a seek itself is a small audible glitch), small enough that the backing track can't
 * noticeably drift out of alignment with the click track or another tablet's copy of the same
 * file over a long song. */
const DRIFT_CORRECTION_THRESHOLD_MS = 200

/** Re-locks `audio.currentTime` to the synced master clock if (and only if) it has drifted past
 * the threshold - the backing-track equivalent of clickEngine.ts's scheduler continuously
 * re-anchoring to `elapsedMs` every tick. Meant to be called periodically (useAudioOutputDriver.ts)
 * while this device is the claimed local output and actively playing - a native `<audio>`
 * element isn't guaranteed sample-accurate or perfectly clock-locked, and nothing else ever
 * re-checks it once playback starts (found live, 2026-09-10: the backing track and the click
 * had no ongoing synchronization with each other, or with another tablet's own copy, at all). */
export function syncLocalTrackPosition(atMs: number): void {
  const audio = getAudioEl()
  if (audio.paused) return
  const driftMs = audio.currentTime * 1000 - atMs
  if (Math.abs(driftMs) > DRIFT_CORRECTION_THRESHOLD_MS) audio.currentTime = atMs / 1000
}

export function stopLocalTrack(): void {
  const audio = getAudioEl()
  audio.pause()
  audio.currentTime = 0
}

/** Clears whatever is currently loaded, if anything - unlike stopLocalTrack (pause + rewind,
 * keeping the same track cued up for a quick replay), this drops the source entirely. Needed
 * whenever the current song has no track at all: without it, the previous song's audio stays
 * loaded in the shared `<audio>` element, and a later Play on the trackless song would just
 * resume playing the old one instead of staying silent as the UI's "Kein Track angehängt"
 * implies. */
export function unloadLocalTrack(): void {
  const audio = getAudioEl()
  if (!audio.src) return
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = null
  }
}

/** Test-only escape hatch - this module deliberately never exposes its module-level `<audio>`
 * singleton otherwise (every real caller goes through the functions above instead), but a test
 * asserting on `currentTime`/`paused` needs some way to read it back. */
export function __getAudioElForTests(): HTMLAudioElement {
  return getAudioEl()
}
