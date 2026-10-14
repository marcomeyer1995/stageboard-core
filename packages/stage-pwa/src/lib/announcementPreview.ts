import type { AnnouncementSettings } from 'shared-types'
import { sectionAnnouncements } from './announcements'
import { clickTimeline } from './beatGrid'
import { playClickAt } from './clickEngine'
import { getSharedAudioContext } from './sharedAudioContext'
import { loadSpeechClip, type ClipVoice } from './speechClips'

/** A short made-up song for "Ablauf anhören": count-in, Intro on bar 1, `part` on bar 4. */
export function previewSong(part: string, bpm: number, countInBars: number) {
  const timeline = clickTimeline({ bpm, timeSignature: '4/4', countInBars })
  const tag = (ms: number) => {
    const s = Math.max(0, ms) / 1000
    return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}]`
  }
  const content = `{part: Intro}\n${tag(timeline.timeOfBeat(0))}x\n{part: ${part}}\n${tag(timeline.timeOfBeat(timeline.barStartBeat(4)))}y`
  return { timeline, content, endBeat: timeline.barStartBeat(5) }
}

/**
 * Plays the band's announcement settings once on this device, with the click: a count-in, an
 * Intro and the chosen part - so countdown, the name's bar and the count-in mode can be heard
 * before a gig. Returns false when a word's clip can't be had.
 */
export async function playAnnouncementPreview(part: string, bpm: number, settings: AnnouncementSettings, voice: ClipVoice): Promise<boolean> {
  const { timeline, content, endBeat } = previewSong(part, bpm, 1)
  const words = sectionAnnouncements(content, timeline, settings)
  const clips = await Promise.all(words.map((w) => loadSpeechClip(w.text, voice)))
  if (clips.some((c) => c === null)) return false
  const ctx = getSharedAudioContext()
  await ctx.resume()
  const firstMs = timeline.timeOfBeat(timeline.firstBeat)
  const start = ctx.currentTime + 0.3
  const at = (ms: number) => start + (ms - firstMs) / 1000
  for (let beat = timeline.firstBeat; beat <= endBeat; beat++) playClickAt(ctx, at(timeline.timeOfBeat(beat)), timeline.beatInBar(beat) === 0)
  let last: { node: AudioBufferSourceNode; gain: GainNode; when: number } | null = null
  words.forEach((word, i) => {
    const when = at(word.atMs)
    const node = ctx.createBufferSource()
    node.buffer = clips[i]!
    const gain = ctx.createGain()
    node.connect(gain).connect(ctx.destination)
    node.start(when)
    if (last) {
      last.gain.gain.setTargetAtTime(0, when, 0.005)
      last.node.stop(when + 0.03)
    }
    last = { node, gain, when }
  })
  return true
}
