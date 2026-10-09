import { describe, expect, it } from 'vitest'
import { clickTimeline } from './beatGrid'
import { parseChordPro } from './chordpro'
import { buildReferenceSong, encodeWav, REFERENCE_LEAD_IN_MS, synthesizeBeeps, synthesizeDrums } from './referenceSong'

const song = buildReferenceSong()
const timeline = clickTimeline({ beatGrid: song.grid, bpm: song.bpm, timeSignature: song.timeSignature, countInBars: 1 })

describe('reference song (#464)', () => {
  it('the app click grid lands on every generated beat - except inside a bar with a tempo change', () => {
    const errors: { bar: number; beat: number; ms: number }[] = []
    for (const b of song.beats) {
      const beatNumber = timeline.barStartBeat(b.bar) + b.beat
      const ms = timeline.timeOfBeat(beatNumber) - b.timeMs
      if (song.approximateBars.includes(b.bar)) continue
      if (Math.abs(ms) > 1) errors.push({ bar: b.bar, beat: b.beat, ms: Math.round(ms * 10) / 10 })
    }
    expect(errors).toEqual([])
  })

  it('the bar with the change inside it is off by a known amount - the limit of bar-start grid points', () => {
    const [bar] = song.approximateBars
    const off = song.beats
      .filter((b) => b.bar === bar)
      .map((b) => Math.abs(timeline.timeOfBeat(timeline.barStartBeat(b.bar) + b.beat) - b.timeMs))
    expect(Math.max(...off)).toBeGreaterThan(20)
    // ... and the next bar is exact again.
    const next = song.beats.find((b) => b.bar === bar! + 1 && b.beat === 0)!
    expect(Math.abs(timeline.timeOfBeat(timeline.barStartBeat(next.bar)) - next.timeMs)).toBeLessThanOrEqual(1)
  })

  it('meters, count-in and sections line up with the app', () => {
    const threeFour = song.sections.find((s) => s.name === 'three-four')!
    expect(timeline.timeSignatureAt(timeline.barStartBeat(threeFour.bar))).toBe('3/4')
    expect(timeline.timeSignatureAt(timeline.barStartBeat(threeFour.bar + 6))).toBe('4/4')
    // One count-in bar at 120 fills the lead-in exactly.
    expect(timeline.timeOfBeat(timeline.firstBeat)).toBeCloseTo(0, 0)
    expect(timeline.bar1Ms).toBe(REFERENCE_LEAD_IN_MS)
    expect(song.sections.map((s) => s.name)).toEqual(['steady', 'ritardando', 'slow', 'jump', 'change-in-bar', 'three-four', 'rest', 'reentry', 'ending'])
  })

  it('the ritardando slows evenly from 120 to 90', () => {
    const rit = song.beats.filter((b) => b.section === 'ritardando')
    expect(rit[0]!.bpm).toBeCloseTo(120, 5)
    const last = rit[rit.length - 1]!
    expect(60000 / (song.beats[song.beats.indexOf(last) + 1]!.timeMs - last.timeMs)).toBeGreaterThan(89)
    const gaps = rit.slice(1).map((b, i) => b.timeMs - rit[i]!.timeMs)
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!)
  })

  it('every bar has one prompter line at its start, and the alerts are there', () => {
    const text = (l: ReturnType<typeof parseChordPro>[number]) => l.segments.map((s) => s.text).join('')
    const lines = parseChordPro(song.chordPro).filter((l) => l.timeMs !== null)
    const bars = new Set(song.beats.map((b) => b.bar))
    const lyricLines = lines.filter((l) => /Takt \d+/.test(text(l)))
    expect(lyricLines).toHaveLength(bars.size)
    for (const l of lyricLines) {
      const bar = Number(/Takt (\d+)/.exec(text(l))![1])
      const start = song.beats.find((b) => b.bar === bar && b.beat === 0)!.timeMs
      expect(Math.abs(l.timeMs! - start)).toBeLessThanOrEqual(5) // ChordPro tags have 10 ms steps
    }
    expect(song.chordPro).toContain('{alert: Ritardando in 2 Takten}')
  })

  it('the beeps start on the beat and stay silent in the rest; the WAV is valid', () => {
    const rate = 8000
    const beeps = synthesizeBeeps(song, rate)
    const first = song.beats[0]!
    const at = Math.round((first.timeMs / 1000) * rate)
    expect(Math.abs(beeps[at - 1]!)).toBe(0)
    expect(Math.max(...Array.from(beeps.slice(at, at + 40), Math.abs))).toBeGreaterThan(0.3)
    const rest = song.sections.find((s) => s.name === 'rest')!
    const restEnd = song.sections.find((s) => s.name === 'reentry')!
    const quiet = beeps.slice(Math.round((rest.timeMs / 1000) * rate) + 400, Math.round((restEnd.timeMs / 1000) * rate) - 10)
    expect(Math.max(...Array.from(quiet, Math.abs))).toBeLessThan(1e-3)
    const wav = encodeWav(beeps, rate)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(wav.length).toBe(44 + beeps.length * 2)
    expect(synthesizeDrums(song, rate).length).toBe(beeps.length)
  })
})
