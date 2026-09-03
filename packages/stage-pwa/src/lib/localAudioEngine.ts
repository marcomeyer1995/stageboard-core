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

/** Loads a track's audio attachment and cues it up at position 0. Revokes the previous
 * object URL first - PouchDB attachments are fetched as Blobs, and object URLs otherwise leak
 * for the lifetime of the page. */
export async function loadLocalTrack(variantId: string, trackId: string): Promise<LocalAudioResult> {
  const blob = await getTrack(variantId, trackId)
  if (!blob) return { status: 'error', message: 'Kein Track gefunden' }

  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl)
  currentObjectUrl = URL.createObjectURL(blob)

  const audio = getAudioEl()
  audio.src = currentObjectUrl
  audio.currentTime = 0
  return { status: 'ok' }
}

export function playLocalTrack(): void {
  // play() returns a promise that rejects with AbortError if pause() interrupts it before it
  // resolves (e.g. a quick double-tap) - expected, not a bug (same as BackingTrackPlayerWidget
  // and TapToSync's identical pattern).
  void getAudioEl().play().catch(() => {})
}

export function pauseLocalTrack(): void {
  getAudioEl().pause()
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
