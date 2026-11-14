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

/**
 * The song's announcements as the engine's clip: each word once, and where it is said. Words
 * without a clip are left out (as the WebView skips them); null when none has one.
 */
export function announcementClip(items: Announcement[], clipOf: (text: string) => AudioBuffer | null): AnnouncementClip | null {
  const placed = items
    .map((item) => ({ item, buffer: clipOf(item.text) }))
    .filter((p): p is { item: Announcement; buffer: AudioBuffer } => p.buffer !== null)
    .sort((a, b) => a.item.atMs - b.item.atMs)
  if (placed.length === 0) return null
  const rate = placed[0]!.buffer.sampleRate
  const songStartMs = Math.min(0, placed[0]!.item.atMs)
  const index = new Map<string, number>()
  const words: string[] = []
  const starts: number[] = []
  const wordOf: number[] = []
  for (const { item, buffer } of placed) {
    if (buffer.sampleRate !== rate) continue
    let w = index.get(item.text)
    if (w === undefined) {
      w = words.length
      index.set(item.text, w)
      words.push(base64(pcm16(buffer)))
    }
    starts.push(Math.round(((item.atMs - songStartMs) * rate) / 1000))
    wordOf.push(w)
  }
  return { rate, songStartMs, words, starts, wordOf }
}
