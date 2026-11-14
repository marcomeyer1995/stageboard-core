import type { Announcement } from '../announcements'
import type { AnnouncementClip } from '../nativeOutput'

/** Bytes as base64 - the plugin bridge carries strings. */
export function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Mono int16, little-endian - a stereo clip's channels averaged. */
function pcm16(buffer: AudioBuffer): Uint8Array {
  const n = buffer.length
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (const ch of channels) sum += ch[i]!
    const v = Math.max(-1, Math.min(1, sum / channels.length))
    out[i] = Math.round(v * 32767)
  }
  return new Uint8Array(out.buffer)
}

/** Envelope window and how far below its loudest the vowel counts as begun. */
const ONSET_WINDOW_MS = 5
const ONSET_BELOW_DB = 10
/** No word is moved further than this. */
export const MAX_ONSET_MS = 200
const onsets = new WeakMap<AudioBuffer, number>()

/**
 * Where a spoken word's vowel begins, in ms from the clip's start (#842): the beat is heard there,
 * not at the clip's first sample - Piper's words reach it 5-155 ms in ("Drei" 5, "Vier" 55,
 * "Strophe" 155), so a count-in placed by the clip's start limped by up to 50 ms from number to
 * number. The first 5-ms window within 10 dB of the word's loudest.
 */
export function vowelOnsetMs(buffer: AudioBuffer): number {
  const known = onsets.get(buffer)
  if (known !== undefined) return known
  const data = buffer.getChannelData(0)
  const win = Math.max(1, Math.round((buffer.sampleRate * ONSET_WINDOW_MS) / 1000))
  const env: number[] = []
  for (let i = 0; i + win <= data.length; i += win) {
    let sum = 0
    for (let j = i; j < i + win; j++) sum += data[j]! * data[j]!
    env.push(Math.sqrt(sum / win))
  }
  const loudest = Math.max(0, ...env)
  const at = loudest > 0 ? env.findIndex((e) => e >= loudest * 10 ** (-ONSET_BELOW_DB / 20)) : 0
  const ms = Math.min(MAX_ONSET_MS, Math.max(0, at) * ONSET_WINDOW_MS)
  onsets.set(buffer, ms)
  return ms
}

/** Words placed by their vowel (default) or, switched off with `sb:debug:voice-align` = 0, by
 * the clip's start - for comparing by ear. */
export function alignsOnVowel(): boolean {
  try {
    return localStorage.getItem('sb:debug:voice-align') !== '0'
  } catch {
    return true
  }
}

/**
 * The song's announcements as the engine's clip: each word once, and where it is said. Words
 * without a clip are left out (as the WebView skips them); null when none has one.
 */
export function announcementClip(items: Announcement[], clipOf: (text: string) => AudioBuffer | null, onVowel = true): AnnouncementClip | null {
  const placed = items
    .map((item) => ({ item, buffer: clipOf(item.text) }))
    .filter((p): p is { item: Announcement; buffer: AudioBuffer } => p.buffer !== null)
    .map((p) => ({ ...p, startMs: p.item.atMs - (onVowel ? vowelOnsetMs(p.buffer) : 0) }))
    .sort((a, b) => a.startMs - b.startMs)
  if (placed.length === 0) return null
  const rate = placed[0]!.buffer.sampleRate
  const songStartMs = Math.min(0, placed[0]!.startMs)
  const index = new Map<string, number>()
  const words: string[] = []
  const starts: number[] = []
  const wordOf: number[] = []
  for (const { item, buffer, startMs } of placed) {
    if (buffer.sampleRate !== rate) continue
    let w = index.get(item.text)
    if (w === undefined) {
      w = words.length
      index.set(item.text, w)
      words.push(base64(pcm16(buffer)))
    }
    starts.push(Math.round(((startMs - songStartMs) * rate) / 1000))
    wordOf.push(w)
  }
  return { rate, songStartMs, words, starts, wordOf }
}
