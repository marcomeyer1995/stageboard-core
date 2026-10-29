import { describe, expect, it } from 'vitest'
import { SongVariantSchema } from 'shared-types'
import { clickTimeline } from './beatGrid'
import { parseChordPro, songAlerts } from './chordpro'
import { countInLeadMs } from './metronome'
import { partSectionStarts } from './showSections'
import {
  buildRigCheckSong,
  encodeWav,
  isRigCheckId,
  RIG_CHECK_LEAD_IN_MS,
  RIG_CHECK_TRACK_ID,
  rigCheckCues,
  rigCheckVariant,
  SKIPPED_TEXT,
  synthesizeBeeps,
  synthesizeDrums,
  synthesizeRigCheckTrack,
  type RigCheckKind,
} from './rigCheckSong'

const timelineOf = (kind: RigCheckKind) => {
  const song = buildRigCheckSong(kind)
  return { song, timeline: clickTimeline({ beatGrid: song.grid, bpm: song.bpm, timeSignature: song.timeSignature, countInBars: 1 }) }
}

describe.each<RigCheckKind>(['quick', 'full'])('Rig-Check song %s (#464)', (kind) => {
  const { song, timeline } = timelineOf(kind)

  it('the app click grid lands on every generated beat - except inside a bar with a tempo change', () => {
    const errors: { bar: number; beat: number; ms: number }[] = []
    for (const b of song.beats) {
      if (song.approximateBars.includes(b.bar)) continue
      const ms = timeline.timeOfBeat(timeline.barStartBeat(b.bar) + b.beat) - b.timeMs
      if (Math.abs(ms) > 1) errors.push({ bar: b.bar, beat: b.beat, ms: Math.round(ms * 10) / 10 })
    }
    expect(errors).toEqual([])
  })

  it('one count-in bar at 120 fills the lead-in exactly - no negative start', () => {
    expect(timeline.bar1Ms).toBe(RIG_CHECK_LEAD_IN_MS)
    expect(timeline.timeOfBeat(timeline.firstBeat)).toBeCloseTo(0, 0)
    expect(countInLeadMs(timeline)).toBeCloseTo(0, 0)
  })

  it('every part is a show section on its bar - the jump targets exist', () => {
    const parts = partSectionStarts(song.chordPro, timeline)
    expect(parts.map((p) => p.label)).toEqual(song.sections.map((s) => s.label))
    for (const p of parts) {
      const s = song.sections.find((x) => x.label === p.label)!
      expect(p.bar).toBe(s.bar)
      expect(Math.abs(p.startMs - s.timeMs)).toBeLessThanOrEqual(1)
    }
    const labels = parts.map((p) => p.label)
    const from = labels.indexOf(song.jump.from)
    expect(labels[from + 1]).toBe('Übersprungen')
    expect(labels[from + 2]).toBe(song.jump.to)
  })

  it('every bar has one prompter line at its start; the skipped bars say so', () => {
    const text = (l: ReturnType<typeof parseChordPro>[number]) => l.segments.map((s) => s.text).join('')
    const lyricLines = parseChordPro(song.chordPro).filter((l) => l.timeMs !== null && /Takt \d+/.test(text(l)))
    expect(lyricLines).toHaveLength(new Set(song.beats.map((b) => b.bar)).size)
    for (const l of lyricLines) {
      const bar = Number(/Takt (\d+)/.exec(text(l))![1])
      const start = song.beats.find((b) => b.bar === bar && b.beat === 0)!
      expect(Math.abs(l.timeMs! - start.timeMs)).toBeLessThanOrEqual(5) // ChordPro tags have 10 ms steps
      expect(text(l).includes(SKIPPED_TEXT)).toBe(start.section === 'skipped')
    }
  })

  it('the alerts are in the text at their times - one only shows when the jump failed', () => {
    const alerts = songAlerts(song.chordPro)
    expect(alerts.map((a) => a.text)).toEqual(song.alerts.map((a) => a.text))
    for (const [i, a] of alerts.entries()) expect(Math.abs(a.timeMs - song.alerts[i]!.timeMs)).toBeLessThanOrEqual(5)
    const skipped = song.sections.find((s) => s.skipped)!
    expect(song.alerts.find((a) => a.text === SKIPPED_TEXT)!.timeMs).toBe(skipped.timeMs)
  })

  it('device cues go out at every cue time, to every chosen device, with stable ids', () => {
    const chosen = [
      { targetLogicalDeviceId: 'kemper', type: 'kemper.tuner', payload: { on: true } },
      { targetLogicalDeviceId: 'rc500', type: 'rc500.patch', payload: { patch: 3 } },
    ]
    const cues = rigCheckCues(song, chosen)
    expect(cues).toHaveLength(song.cueTimesMs.length * 2)
    expect(new Set(cues.map((c) => c.id)).size).toBe(cues.length)
    expect(cues.filter((c) => c.targetLogicalDeviceId === 'kemper').map((c) => c.timeMs)).toEqual(song.cueTimesMs)
    expect(rigCheckCues(song, chosen)).toEqual(cues)
    // No cue inside the section the master jumps over: it would never go out.
    const skipped = song.sections.find((s) => s.skipped)!
    const after = song.sections[song.sections.indexOf(skipped) + 1]!
    expect(cues.every((c) => c.timeMs < skipped.timeMs || c.timeMs >= after.timeMs)).toBe(true)
  })

  it('the variant is valid and plays grid, click, count-in and the track', () => {
    const track = { id: RIG_CHECK_TRACK_ID, kind: 'band-mix' as const, label: 'Rig-Check', source: 'upload' as const, parentTrackId: null, mimeType: 'audio/wav', addedAt: 0, durationMs: song.durationMs }
    const variant = SongVariantSchema.parse(rigCheckVariant(song, [], [track]))
    expect(variant.clickTrackEnabled).toBe(true)
    expect(variant.countInEnabled).toBe(true)
    expect(variant.beatGrid).toEqual(song.grid)
    expect(variant.tracks).toEqual([track])
    expect(isRigCheckId(variant.songId)).toBe(true)
  })
})

describe('Rig-Check runs', () => {
  it('the quick check takes about 45 s, the full run about 2½ min', () => {
    expect(buildRigCheckSong('quick').durationMs).toBeGreaterThan(30_000)
    expect(buildRigCheckSong('quick').durationMs).toBeLessThan(50_000)
    expect(buildRigCheckSong('full').durationMs).toBeGreaterThan(120_000)
    expect(buildRigCheckSong('full').durationMs).toBeLessThan(180_000)
  })

  it('the bar with the change inside it is off by a known amount - the limit of bar-start grid points', () => {
    const { song, timeline } = timelineOf('full')
    const [bar] = song.approximateBars
    const off = song.beats.filter((b) => b.bar === bar).map((b) => Math.abs(timeline.timeOfBeat(timeline.barStartBeat(b.bar) + b.beat) - b.timeMs))
    expect(Math.max(...off)).toBeGreaterThan(20)
    const next = song.beats.find((b) => b.bar === bar! + 1 && b.beat === 0)!
    expect(Math.abs(timeline.timeOfBeat(timeline.barStartBeat(next.bar)) - next.timeMs)).toBeLessThanOrEqual(1)
  })

  it('the full run changes to 3/4 and back, and slows evenly from 120 to 90', () => {
    const { song, timeline } = timelineOf('full')
    const threeFour = song.sections.find((s) => s.name === 'three-four')!
    const rest = song.sections.find((s) => s.name === 'rest')!
    expect(timeline.timeSignatureAt(timeline.barStartBeat(threeFour.bar))).toBe('3/4')
    expect(timeline.timeSignatureAt(timeline.barStartBeat(rest.bar))).toBe('4/4')
    const rit = song.beats.filter((b) => b.section === 'ritardando')
    expect(rit[0]!.bpm).toBeCloseTo(120, 5)
    const gaps = rit.slice(1).map((b, i) => b.timeMs - rit[i]!.timeMs)
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!)
  })

  it('isRigCheckId knows only the fixed ids', () => {
    expect(isRigCheckId('rig-check')).toBe(true)
    expect(isRigCheckId('rig-check-2')).toBe(false)
    expect(isRigCheckId('a1b2c3')).toBe(false)
  })
})

describe('Rig-Check sound', () => {
  const rate = 8000

  it('the beeps start on the beat and stay silent in the rest; the WAV is valid', () => {
    const song = buildRigCheckSong('full')
    const beeps = synthesizeBeeps(song, rate)
    const at = Math.round((song.beats[0]!.timeMs / 1000) * rate)
    expect(Math.abs(beeps[at - 1]!)).toBe(0)
    expect(Math.max(...Array.from(beeps.slice(at, at + 40), Math.abs))).toBeGreaterThan(0.3)
    const rest = song.sections.find((s) => s.name === 'rest')!
    const reentry = song.sections.find((s) => s.name === 'reentry')!
    const quiet = beeps.slice(Math.round((rest.timeMs / 1000) * rate) + 400, Math.round((reentry.timeMs / 1000) * rate) - 10)
    expect(Math.max(...Array.from(quiet, Math.abs))).toBeLessThan(1e-3)
    const wav = encodeWav(beeps, rate)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(wav.length).toBe(44 + beeps.length * 2)
    expect(synthesizeDrums(song, rate).length).toBe(beeps.length)
  })

  it('the mixed track never clips and is the same every time', () => {
    const song = buildRigCheckSong('quick')
    const a = synthesizeRigCheckTrack(song, rate)
    expect(a.reduce((m, x) => Math.max(m, Math.abs(x)), 0)).toBeLessThanOrEqual(0.9 + 1e-6)
    expect(synthesizeRigCheckTrack(song, rate)).toEqual(a)
  })
})
