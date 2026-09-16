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

/** Whichever `loadLocalTrack` call is currently in flight, if any - `playLocalTrack` awaits this
 * before touching the element (see its own doc comment) so a play attempt can never race ahead
 * of the load it depends on. */
let pendingLoad: Promise<LocalAudioResult> | null = null

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
export function loadLocalTrack(variantId: string, trackId: string, atMs: number): Promise<LocalAudioResult> {
  const promise = (async (): Promise<LocalAudioResult> => {
    const blob = await getTrack(variantId, trackId)
    if (!blob) return { status: 'error', message: 'Kein Track gefunden' }

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = URL.createObjectURL(blob)

    const audio = getAudioEl()
    audio.src = currentObjectUrl
    audio.currentTime = atMs / 1000
    return { status: 'ok' }
  })()
  pendingLoad = promise
  void promise.finally(() => {
    if (pendingLoad === promise) pendingLoad = null
  })
  return promise
}

/** Seeks to `atMs` before starting - without this, resuming played from wherever the element
 * happened to be cued (stale from a previous song, or the load-time position even if paused
 * partway through), not the actual synced position (found live, 2026-09-10 alongside the
 * missing sync fix below).
 *
 * Returns whether playback actually started, not just whether it was attempted - `audio.play()`
 * can reject for two very different reasons. `AbortError` (pause() interrupting play() before it
 * resolves, e.g. a quick double-tap) is expected and swallowed, same as BackingTrackPlayerWidget
 * and TapToSync's identical pattern. Anything else - in practice almost always `NotAllowedError`,
 * the browser's autoplay policy refusing an unattended `play()` call with no user gesture behind
 * it - is a real failure callers need to know about: useAudioOutputDriver.ts's reload-time
 * auto-resume has no gesture to offer, so a reload during an already-playing song silently lost
 * its audio with no indication anything had gone wrong (found live, 2026-09-16).
 *
 * Waits for any in-flight `loadLocalTrack` first - useAudioOutputDriver.ts's load and play
 * effects fire independently (deliberately, see its own doc comment on why they can't share one
 * dependency array), so this can otherwise run before the Blob fetch behind `loadLocalTrack`
 * finishes, calling `audio.play()` on an element with no source yet. That rejection has nothing
 * to do with the browser's autoplay policy, but without this wait it got reported as exactly
 * that ("tap to resume") - and a user's actual tap, landing while the same load was still in
 * flight, could race the same way and silently fail again, looking like the button just wasn't
 * working (found live, 2026-09-16, the day after the autoplay-block fix itself). */
export async function playLocalTrack(atMs: number): Promise<LocalAudioResult> {
  if (pendingLoad) await pendingLoad.catch(() => {})
  const audio = getAudioEl()
  audio.currentTime = atMs / 1000
  try {
    await audio.play()
    return { status: 'ok' }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return { status: 'ok' }
    return { status: 'error', message: 'Wiedergabe durch den Browser blockiert - bitte antippen' }
  }
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

/** This tablet's own loaded track's length, once the browser has parsed its metadata - `null`
 * before any track is loaded, or while a freshly-`loadLocalTrack`-ed one's duration genuinely
 * isn't known yet. Read fresh off the element rather than cached at load time:
 * `HTMLMediaElement.duration` only becomes a real number sometime after `src` is assigned, not
 * synchronously - useAutoStopDriver.ts polls this every tick rather than needing to be told once
 * it's ready. Naturally resets to unknown (NaN) the moment `src` changes (a new `loadLocalTrack`
 * or `unloadLocalTrack`), so a stale duration can never leak onto a different, just-loaded song. */
export function getLocalTrackDurationMs(): number | null {
  const duration = getAudioEl().duration
  return Number.isFinite(duration) ? duration * 1000 : null
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
