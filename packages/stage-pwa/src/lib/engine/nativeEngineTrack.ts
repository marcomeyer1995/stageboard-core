import { nativeEngine } from '../nativeOutput'
import { getTrack } from '../songVariantsDb'
import { useNativeTrackStore, type NativeTrackStatus } from './nativeTrackStore'
import { ENGINE_BUS } from './wasmEngine'
import { base64 } from './announcementClip'

export { useNativeTrackStore } from './nativeTrackStore'

/**
 * The backing track from the engine core in the native output's callback (docs/30 §8h stage 4),
 * on while the native output plays (`sb:debug:native-track` = 0 switches it off): one clock and one buffer
 * for click and track - nothing between them that could drift (the click alone in the engine sat
 * off a track that came through the pipe, until both were on one clock, 2026-11-13).
 *
 * The track's Ogg Opus file (the track format, #836) goes to the engine once per song, in pieces;
 * the engine streams it (StreamedClip: compressed in memory, two decoded windows). Meanwhile the
 * `<audio>` element (Solo Üben) is held silent and the Web Audio track (Gig) not started. A track
 * that is not Ogg Opus yet plays as before.
 *
 * Not yet: the track's level curve (cues "Track leiser"), stems - they stay in the WebView.
 */

/** The one clip id the track uses (engine.h kMaxClips: 0-31). */
export const TRACK_CLIP = 0
/** Raw bytes per plugin call - base64 grows them by a third; ~1 MB a call keeps the bridge short. */
const CHUNK_BYTES = 768 * 1024

export function wantsNativeTrack(): boolean {
  try {
    return localStorage.getItem('sb:debug:native-track') !== '0'
  } catch {
    return true
  }
}

/** Ogg with an OpusHead in its first page - what the engine plays. */
export async function isOggOpus(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 36).arrayBuffer())
  const text = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to))
  return head.length >= 36 && text(0, 4) === 'OggS' && text(28, 36) === 'OpusHead'
}


let generation = 0

/** Hands the track's file to the engine. A newer call (a skipped song) wins - the older one stops. */
export async function loadNativeTrack(variantId: string, trackId: string): Promise<NativeTrackStatus> {
  const mine = ++generation
  const key = `${variantId}:${trackId}`
  const set = (status: NativeTrackStatus, error: string | null = null) => {
    if (mine === generation) useNativeTrackStore.setState({ key, status, error })
    return status
  }
  set('loading')
  try {
    const blob = await getTrack(variantId, trackId)
    if (mine !== generation) return 'idle'
    if (!blob) return set('error', 'no file')
    if (!(await isOggOpus(blob))) return set('not-opus')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    await nativeEngine.clipBegin(TRACK_CLIP, bytes.length)
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      if (mine !== generation) return 'idle'
      const { ok } = await nativeEngine.clipChunk(TRACK_CLIP, offset, base64(bytes.subarray(offset, offset + CHUNK_BYTES)))
      if (!ok) return set('error', 'chunk refused')
    }
    if (mine !== generation) return 'idle'
    // At song time 0, on the track bus; level and place come with every update.
    const { error } = await nativeEngine.clipCommit(TRACK_CLIP, 0, ENGINE_BUS.track, 0)
    if (mine !== generation) return 'idle'
    return error ? set('error', error) : set('ready')
  } catch (err) {
    return set('error', String(err))
  }
}

export function unloadNativeTrack(): void {
  generation++
  nativeEngine.clipRemove(TRACK_CLIP)
  useNativeTrackStore.setState({ key: null, status: 'idle', error: null })
}

