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

/** A second, already-buffered element for the entry after the current one (#232's seamless
 * transition) - `loadLocalTrack` swaps it in instead of fetching, so the handoff has no
 * Blob-fetch gap. `activeKey`/`preloaded.key` are `variantId:trackId`. */
let activeKey: string | null = null
let preloaded: { key: string; el: HTMLAudioElement; objectUrl: string } | null = null
let pendingPreload: { key: string; promise: Promise<void> } | null = null

function trackKey(variantId: string, trackId: string): string {
  return `${variantId}:${trackId}`
}

function releasePreloaded(): void {
  if (preloaded) URL.revokeObjectURL(preloaded.objectUrl)
  preloaded = null
}

/** Buffers a track in the background without touching what's currently playing. No-op if that
 * track is already active or preloaded; a different pending preload is simply superseded. */
export function preloadLocalTrack(variantId: string, trackId: string): Promise<void> {
  const key = trackKey(variantId, trackId)
  if (key === activeKey || preloaded?.key === key) return Promise.resolve()
  if (pendingPreload?.key === key) return pendingPreload.promise
  releasePreloaded()
  const promise = (async () => {
    const blob = await getTrack(variantId, trackId)
    if (!blob || pendingPreload?.key !== key) return
    const objectUrl = URL.createObjectURL(blob)
    const el = new Audio()
    el.preload = 'auto'
    el.src = objectUrl
    preloaded = { key, el, objectUrl }
  })().finally(() => {
    if (pendingPreload?.key === key) pendingPreload = null
  })
  pendingPreload = { key, promise }
  return promise
}

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
  const key = trackKey(variantId, trackId)
  const promise = (async (): Promise<LocalAudioResult> => {
    if (pendingPreload?.key === key) await pendingPreload.promise.catch(() => {})
    if (preloaded?.key === key) {
      // Swap in the already-buffered element: nothing to fetch, so playback can start at once.
      const old = audioEl
      old?.pause()
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl)
      audioEl = preloaded.el
      currentObjectUrl = preloaded.objectUrl
      preloaded = null
      activeKey = key
      seekTo(audioEl, atMs)
      return { status: 'ok' }
    }
    const blob = await getTrack(variantId, trackId)
    if (!blob) return { status: 'error', message: 'Kein Track gefunden' }

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = URL.createObjectURL(blob)

    const audio = getAudioEl()
    audio.src = currentObjectUrl
    seekTo(audio, atMs)
    activeKey = key
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
 * resolves, e.g. a quick double-tap) is expected and swallowed, same as BackingTrackPlayerWidget's
 * identical pattern. Anything else - in practice almost always `NotAllowedError`,
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
  // A Play right after Stop/Pause must not be cut off by that fade's closing pause().
  cancelFade(audio)
  seekTo(audio, atMs)
  try {
    await audio.play()
    return { status: 'ok' }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return { status: 'ok' }
    return { status: 'error', message: 'Wiedergabe durch den Browser blockiert - bitte antippen' }
  }
}

/** Length of the fade before a pause/stop, ms - a hard `pause()` mid-waveform is an audible
 * crack; this is short enough to still feel instant. */
const FADE_OUT_MS = 60
const FADE_STEP_MS = 5

let fade: { audio: HTMLAudioElement; timer: ReturnType<typeof setInterval>; volume: number } | null = null

/** Stops a running fade and puts the element's volume back - it is only ever lowered for a fade. */
function cancelFade(audio: HTMLAudioElement): void {
  if (!fade || fade.audio !== audio) return
  clearInterval(fade.timer)
  audio.volume = fade.volume
  fade = null
}

/** Fades the element out over FADE_OUT_MS, then pauses it and restores its volume. Nothing to
 * fade on an element that isn't playing. */
function fadeOutAndPause(audio: HTMLAudioElement): void {
  if (audio.paused) return
  if (fade?.audio === audio) return // already fading out
  cancelFade(audio)
  const volume = audio.volume
  const started = performance.now()
  const timer = setInterval(() => {
    const progress = Math.min(1, (performance.now() - started) / FADE_OUT_MS)
    audio.volume = volume * (1 - progress)
    if (progress < 1) return
    audio.pause()
    cancelFade(audio)
  }, FADE_STEP_MS)
  fade = { audio, timer, volume }
}

export function pauseLocalTrack(): void {
  fadeOutAndPause(getAudioEl())
}

/** Above this a seek is the only sensible correction (a song jumped, a late join) - below it the
 * track catches up through a slightly different speed instead. */
const SEEK_THRESHOLD_MS = 1000
/** Never two seeks closer together than this - a seek is an audible glitch. */
const MIN_SEEK_INTERVAL_MS = 3000
/** Speed correction starts only when the smoothed drift passes this, and then runs at one fixed
 * speed (`CATCH_UP_RATE_OFFSET` off normal, pitch kept) until the drift is down to `CATCH_UP_END_MS`.
 * Every `playbackRate` change costs Chrome a little time and is a small audible glitch: changing it
 * continuously (1 % steps, every ~54 ms) made the Xiaomi lose 37 ms/s and stutter every ~2 s, while
 * the same track at a steady rate 1 ran exactly with the clock (2026-10-09, #468). So: two
 * changes per correction, and in normal play none at all. */
const CATCH_UP_START_MS = 80
const CATCH_UP_END_MS = 10
const CATCH_UP_RATE_OFFSET = 0.03
/** Smoothing of the measured drift (single readings jitter by ±15 ms). */
const DRIFT_SMOOTHING_MS = 500
/** After a start or seek, the position counts as running again once it advanced at least half
 * as fast as the wall clock over this long; at the latest after `SETTLE_TIMEOUT_MS`. */
const SETTLE_WINDOW_MS = 150
const SETTLE_TIMEOUT_MS = 3000

/** Where the current element stands after its last start/seek (#468). `null` = not yet seen. */
let tracking: {
  audio: HTMLAudioElement
  seekAt: number
  settled: boolean
  probe: { at: number; positionMs: number } | null
  /** Smoothed drift and when it was last updated; `null` until the first reading after settling. */
  drift: { ms: number; at: number } | null
  /** While catching up: +1 = track ahead (slowed down), -1 = behind (sped up). */
  catchUp: 1 | -1 | null
} | null = null

function freshTracking(audio: HTMLAudioElement, seekAt: number, settled: boolean): NonNullable<typeof tracking> {
  return { audio, seekAt, settled, probe: null, drift: null, catchUp: null }
}

function now(): number {
  return performance.now()
}

/** Every start and seek goes through here, so the correction knows to wait for it (#468). */
function seekTo(audio: HTMLAudioElement, atMs: number): void {
  audio.currentTime = atMs / 1000
  audio.playbackRate = 1
  tracking = freshTracking(audio, now(), false)
}

/** Whether the position runs again after the last start/seek - measured on 2026-10-09 (#468):
 * on a Galaxy S26+ over Bluetooth the position stood still for 0-620 ms after every start or
 * seek, then ran at exactly normal speed. */
function hasSettled(audio: HTMLAudioElement, t: number): boolean {
  if (!tracking || tracking.audio !== audio) {
    tracking = freshTracking(audio, t, true)
    return true
  }
  if (tracking.settled) return true
  const positionMs = audio.currentTime * 1000
  if (t - tracking.seekAt >= SETTLE_TIMEOUT_MS) tracking.settled = true
  else if (!tracking.probe) tracking.probe = { at: t, positionMs }
  else if (t - tracking.probe.at >= SETTLE_WINDOW_MS) {
    const advanced = positionMs - tracking.probe.positionMs
    if (advanced >= (t - tracking.probe.at) / 2) tracking.settled = true
    else tracking.probe = { at: t, positionMs }
  }
  return tracking.settled
}

/** Keeps the local track on the synced master clock while playing - the backing-track
 * equivalent of clickEngine.ts's scheduler re-anchoring to `elapsedMs` every tick. Called on
 * every frame (useAudioOutputDriver.ts) while this device is the claimed local output - a native
 * `<audio>` element isn't clock-locked, and nothing else re-checks it once playback starts (found
 * live, 2026-09-10).
 *
 * It used to seek whenever the drift passed 200 ms. On an output that needs a moment to start
 * after a seek (Bluetooth on the S26+: up to 620 ms) every seek caused the next one - 195 seeks
 * in 45 s, heard as constant stutter (#468). Now: after a start or seek it waits until the
 * position runs again; a smoothed drift over 80 ms is worked off at one fixed speed (pitch kept),
 * and only a drift over a second still seeks, at most every 3 s. */
export function syncLocalTrackPosition(atMs: number): void {
  const audio = getAudioEl()
  if (audio.paused) return
  const t = now()
  if (!hasSettled(audio, t)) return
  const driftMs = audio.currentTime * 1000 - atMs
  if (Math.abs(driftMs) > SEEK_THRESHOLD_MS && t - (tracking?.seekAt ?? -Infinity) >= MIN_SEEK_INTERVAL_MS) {
    seekTo(audio, atMs)
    return
  }
  const track = tracking
  if (!track) return
  if (!track.drift) track.drift = { ms: driftMs, at: t }
  else {
    track.drift.ms += (driftMs - track.drift.ms) * Math.min(1, (t - track.drift.at) / DRIFT_SMOOTHING_MS)
    track.drift.at = t
  }
  const smoothed = track.drift.ms
  if (track.catchUp === null && Math.abs(smoothed) > CATCH_UP_START_MS) {
    track.catchUp = smoothed > 0 ? 1 : -1
    audio.preservesPitch = true
    audio.playbackRate = 1 - track.catchUp * CATCH_UP_RATE_OFFSET
  } else if (track.catchUp !== null && smoothed * track.catchUp <= CATCH_UP_END_MS) {
    track.catchUp = null
    audio.playbackRate = 1
  }
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

/** Stops playback with a short fade. No seek back to 0: the next `playLocalTrack` sets the
 * position anyway, and seeking right after pausing made the tablet emit a short burst of noise
 * on Stop (measured 2026-09-27: pause, then a seek to 0 within 1 ms). */
export function stopLocalTrack(): void {
  fadeOutAndPause(getAudioEl())
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
  cancelFade(audio)
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  activeKey = null
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = null
  }
}

/** Test-only escape hatch - this module deliberately never exposes its module-level `<audio>`
 * singleton otherwise (every real caller goes through the functions above instead), but a test
 * asserting on `currentTime`/`paused` needs some way to read it back. */
/** Test-only: puts the shared element back to paused at 0 with no fade running. */
export function __resetLocalAudioForTests(): void {
  const audio = getAudioEl()
  cancelFade(audio)
  audio.pause()
  audio.currentTime = 0
  audio.playbackRate = 1
  tracking = null
}

export function __getAudioElForTests(): HTMLAudioElement {
  return getAudioEl()
}
