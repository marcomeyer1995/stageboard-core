import type { BeatGrid, GridPoint, MeterChange } from 'shared-types'

/**
 * The reference song (#464): a synthesized test track whose every beat time is known, to measure
 * click against backing track, latency and tempo handling - first for our own measurements, later
 * built into the app so every band can check its setup. Pure and self-contained (no runtime
 * imports): the CLI (`scripts/make-reference-song.ts`) runs it with plain Node, the app can run it
 * as is.
 *
 * Tempo follows the app's own grid (lib/beatGrid.ts): constant between alignment points, and a
 * gradual stretch (#354) changes the beat *spacing* evenly from beat to beat - so the app's click
 * grid must land on every generated beat. The one deliberate exception is a tempo change inside a
 * bar: grid points sit only at bar starts, which this song shows on purpose.
 */

export interface ReferenceSection {
  name: string
  bars: number
  timeSignature: string
  /** Tempo at the start of the section. */
  bpm: number
  /** Tempo at the end: the spacing changes evenly over the section (ritardando/accelerando). */
  endBpm?: number
  /** A tempo change inside the section's first bar, from this beat (0-based) on. */
  changeInBar?: { beat: number; bpm: number }
  /** No sound - a rest of the whole band (the click and the grid go on). */
  silent?: boolean
  /** Lyrics/prompter text for the section (one line per bar is generated from it). */
  label: string
}

/** The song as agreed for #464 (Marco, 2026-10-09). */
export const REFERENCE_SECTIONS: ReferenceSection[] = [
  { name: 'steady', bars: 16, timeSignature: '4/4', bpm: 120, label: 'Gleichmäßig 120' },
  { name: 'ritardando', bars: 8, timeSignature: '4/4', bpm: 120, endBpm: 90, label: 'Ritardando 120 → 90' },
  { name: 'slow', bars: 4, timeSignature: '4/4', bpm: 90, label: 'Gleichmäßig 90' },
  { name: 'jump', bars: 8, timeSignature: '4/4', bpm: 140, label: 'Sprung auf 140' },
  { name: 'change-in-bar', bars: 6, timeSignature: '4/4', bpm: 140, changeInBar: { beat: 2, bpm: 100 }, label: 'Wechsel mitten im Takt → 100' },
  { name: 'three-four', bars: 6, timeSignature: '3/4', bpm: 100, label: 'Dreiviertel 100' },
  { name: 'rest', bars: 2, timeSignature: '4/4', bpm: 120, silent: true, label: 'Pause' },
  { name: 'reentry', bars: 8, timeSignature: '4/4', bpm: 120, label: 'Wiedereinstieg 120' },
  { name: 'ending', bars: 4, timeSignature: '4/4', bpm: 120, label: 'Schluss' },
]

/** Silence before bar 1 - one bar of count-in at 120 fits exactly (the app clicks it). */
export const REFERENCE_LEAD_IN_MS = 2000

export interface ReferenceBeat {
  /** 1-based bar, as in the app's grid. */
  bar: number
  /** 0-based beat in the bar. */
  beat: number
  timeMs: number
  /** Tempo of the spacing to the next beat. */
  bpm: number
  section: string
  silent: boolean
  /** Pitch of this beat's beep in the "Beeps" track (one per bar, 400-940 Hz, clear of the click's 1000/1500 Hz). */
  pitchHz: number
}

export interface ReferenceMarker {
  timeMs: number
  kind: 'cue' | 'alert'
  text: string
}

export interface ReferenceSong {
  title: string
  bpm: number
  timeSignature: string
  durationMs: number
  beats: ReferenceBeat[]
  /** Section starts: bar and time. */
  sections: { name: string; label: string; bar: number; timeMs: number }[]
  grid: BeatGrid
  /** Bars whose beats the grid cannot place exactly (a tempo change inside the bar). */
  approximateBars: number[]
  /** Cues (to be bound to a device on import) and `{alert:}` flashes at known times. */
  markers: ReferenceMarker[]
  chordPro: string
}

const beatsPerBar = (timeSignature: string) => Number(timeSignature.split('/')[0]) || 4
export const beepPitchHz = (bar: number) => 400 + 60 * ((bar - 1) % 10)

/** `74500` -> `01:14.50`, the app's ChordPro time tag (lib/chordpro.ts). */
function timeTag(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10))
  const minutes = Math.floor(total / 6000)
  const seconds = Math.floor((total % 6000) / 100)
  const hundredths = total % 100
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}]`
}

export function buildReferenceSong(sections: ReferenceSection[] = REFERENCE_SECTIONS, leadInMs = REFERENCE_LEAD_IN_MS): ReferenceSong {
  const beats: ReferenceBeat[] = []
  const sectionStarts: ReferenceSong['sections'] = []
  const points: GridPoint[] = []
  const meters: MeterChange[] = []
  const approximateBars: number[] = []
  let t = leadInMs
  let bar = 1
  let meter = sections[0]!.timeSignature

  for (const s of sections) {
    const perBar = beatsPerBar(s.timeSignature)
    const n = s.bars * perBar
    const p0 = 60000 / s.bpm
    const p1 = 60000 / (s.endBpm ?? s.bpm)
    sectionStarts.push({ name: s.name, label: s.label, bar, timeMs: t })
    points.push({ id: `ref-${s.name}`, bar, timeMs: Math.round(t), ...(s.endBpm !== undefined ? { gradual: true } : {}) })
    if (s.timeSignature !== meter) {
      meters.push({ bar, timeSignature: s.timeSignature })
      meter = s.timeSignature
    }
    if (s.changeInBar) approximateBars.push(bar)
    for (let x = 0; x < n; x++) {
      // Spacing of this beat: an even change over a gradual section (the app's p0 + (p1-p0)·x/N),
      // or the in-bar change from its beat on.
      let period = p0 + ((p1 - p0) * x) / n
      if (s.changeInBar && x >= s.changeInBar.beat) period = 60000 / s.changeInBar.bpm
      const b = bar + Math.floor(x / perBar)
      beats.push({ bar: b, beat: x % perBar, timeMs: t, bpm: 60000 / period, section: s.name, silent: s.silent === true, pitchHz: beepPitchHz(b) })
      // Exact integral of the linear spacing: t advances by the mean of this beat's start and end spacing.
      const next = s.changeInBar && x + 1 >= s.changeInBar.beat ? period : p0 + ((p1 - p0) * (x + 1)) / n
      t += s.endBpm !== undefined ? (period + next) / 2 : period
    }
    if (s.changeInBar && s.bars > 1) {
      // A point at the next bar keeps the in-bar change's error to that one bar.
      const next = beats.find((x) => x.bar === bar + 1 && x.beat === 0)!
      points.push({ id: `ref-${s.name}-2`, bar: bar + 1, timeMs: Math.round(next.timeMs) })
    }
    bar += s.bars
  }
  // The point after the last bar closes the last stretch (and a gradual one before it).
  points.push({ id: 'ref-end', bar, timeMs: Math.round(t) })

  const at = (name: string) => sectionStarts.find((s) => s.name === name)!
  const beatTime = (b: number, beat = 0) => beats.find((x) => x.bar === b && x.beat === beat)!.timeMs
  const markers: ReferenceMarker[] = [
    { timeMs: beatTime(at('steady').bar + 8), kind: 'cue', text: 'Cue 1 - Patch 1' },
    { timeMs: at('ritardando').timeMs, kind: 'cue', text: 'Cue 2 - Patch 2 (Ritardando)' },
    { timeMs: at('jump').timeMs, kind: 'cue', text: 'Cue 3 - Patch 3 (Sprung)' },
    { timeMs: at('reentry').timeMs, kind: 'cue', text: 'Cue 4 - Patch 4 (nach der Pause)' },
    { timeMs: beatTime(at('ritardando').bar - 2), kind: 'alert', text: 'Ritardando in 2 Takten' },
    { timeMs: beatTime(at('rest').bar - 1), kind: 'alert', text: 'Pause in 1 Takt' },
  ]

  const lines: string[] = ['{title: StageBoard Referenz-Song}', '{subtitle: Messung Klick gegen Track (#464)}', '']
  for (const s of sectionStarts) {
    lines.push(`{c: ${s.label}}`)
    const section = sections.find((x) => x.name === s.name)!
    for (let i = 0; i < section.bars; i++) {
      const b = s.bar + i
      const alert = markers.find((m) => m.kind === 'alert' && Math.abs(m.timeMs - beatTime(b)) < 1)
      if (alert) lines.push(`${timeTag(alert.timeMs)} {alert: ${alert.text}}`)
      lines.push(`${timeTag(beatTime(b))} Takt ${b} - ${section.label}`)
    }
    lines.push('')
  }

  return {
    title: 'StageBoard Referenz-Song',
    bpm: sections[0]!.bpm,
    timeSignature: sections[0]!.timeSignature,
    durationMs: Math.round(t + 2000),
    beats,
    sections: sectionStarts,
    grid: { points, meters },
    approximateBars,
    markers,
    chordPro: lines.join('\n'),
  }
}

/** "Beeps": a short sine beep on every beat, its pitch telling the bar - for measuring. */
export function synthesizeBeeps(song: ReferenceSong, sampleRate = 44100): Float32Array {
  const out = new Float32Array(Math.ceil((song.durationMs / 1000) * sampleRate))
  for (const b of song.beats) {
    if (b.silent) continue
    const start = Math.round((b.timeMs / 1000) * sampleRate)
    const amp = b.beat === 0 ? 0.7 : 0.45
    const len = Math.round(0.04 * sampleRate)
    for (let i = 0; i < len && start + i < out.length; i++) {
      const s = i / sampleRate
      // 1 ms rise - a sharp, unambiguous onset - then a quick decay.
      const env = Math.min(1, s / 0.001) * Math.exp(-s / 0.008)
      out[start + i] += amp * env * Math.sin(2 * Math.PI * b.pitchHz * s)
    }
  }
  return out
}

/** "Drums": kick on 1 (and 3 in 4/4), snare on the backbeats, hi-hat eighths - for tempo detection. */
export function synthesizeDrums(song: ReferenceSong, sampleRate = 44100): Float32Array {
  const out = new Float32Array(Math.ceil((song.durationMs / 1000) * sampleRate))
  let seed = 1
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1
  const add = (timeMs: number, ms: number, sample: (s: number) => number) => {
    const start = Math.round((timeMs / 1000) * sampleRate)
    const len = Math.round((ms / 1000) * sampleRate)
    for (let i = 0; i < len && start + i < out.length; i++) out[start + i] += sample(i / sampleRate)
  }
  const kick = (t: number) => add(t, 180, (s) => 0.9 * Math.exp(-s / 0.05) * Math.sin(2 * Math.PI * (50 * s + (70 * (1 - Math.exp(-s / 0.03))) * 0.03)))
  const snare = (t: number) => add(t, 150, (s) => 0.5 * Math.exp(-s / 0.04) * (0.7 * noise() + 0.3 * Math.sin(2 * Math.PI * 190 * s)))
  let prevHat = 0
  const hat = (t: number, amp: number) =>
    add(t, 40, (s) => {
      const n = noise()
      const high = n - prevHat // a crude high-pass
      prevHat = n
      return amp * Math.exp(-s / 0.012) * high
    })
  for (let i = 0; i < song.beats.length; i++) {
    const b = song.beats[i]!
    if (b.silent) continue
    const perBar = beatsPerBar(song.sections.length ? sectionMeter(song, b.bar) : '4/4')
    if (b.beat === 0 || (perBar === 4 && b.beat === 2)) kick(b.timeMs)
    else snare(b.timeMs)
    hat(b.timeMs, 0.25)
    const next = song.beats[i + 1]
    if (next) hat((b.timeMs + next.timeMs) / 2, 0.15)
  }
  return out
}

function sectionMeter(song: ReferenceSong, bar: number): string {
  let meter = song.timeSignature
  for (const m of song.grid.meters) if (m.bar <= bar) meter = m.timeSignature
  return meter
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate = 44100): Uint8Array {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (offset: number, s: string) => [...s].forEach((c, i) => data.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  data.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  data.setUint32(16, 16, true)
  data.setUint16(20, 1, true) // PCM
  data.setUint16(22, 1, true) // mono
  data.setUint32(24, sampleRate, true)
  data.setUint32(28, sampleRate * 2, true)
  data.setUint16(32, 2, true)
  data.setUint16(34, 16, true)
  text(36, 'data')
  data.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) data.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), true)
  return new Uint8Array(data.buffer)
}
