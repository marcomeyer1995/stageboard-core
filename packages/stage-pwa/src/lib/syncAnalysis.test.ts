import { describe, expect, it } from 'vitest'
import { buildReferenceSong, encodeWav, synthesizeBeeps, type ReferenceSong } from './referenceSong'
import { analyzeSyncRecording, decodeWav, synthesizeAppClick } from './syncAnalysis'

const RATE = 16000
const song = buildReferenceSong()

/** A recording as a device would produce it: the song's beeps shifted per beat (`track`), the app's
 * click (1000/1500 Hz, 30 ms - clickEngine.ts) shifted by `click` against song time, a lead of
 * `leadMs` before song time 0, some noise. */
function record(opts: { leadMs: number; track: (i: number, ms: number) => number; click: (i: number, ms: number) => number; cutMs?: number; clicks?: boolean; beeps?: boolean }) {
  const shifted: ReferenceSong = { ...song, durationMs: song.durationMs + opts.leadMs + 500, beats: song.beats.map((b, i) => ({ ...b, timeMs: b.timeMs + opts.leadMs + opts.track(i, b.timeMs) })) }
  const out = opts.beeps === false ? new Float32Array(Math.ceil((shifted.durationMs / 1000) * RATE)) : synthesizeBeeps(shifted, RATE)
  let seed = 7
  for (let i = 0; i < out.length; i++) out[i] += 0.003 * (((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1)
  if (opts.clicks !== false) {
    song.beats.forEach((b, i) => {
      if (!b.silent) synthesizeAppClick(out, b.timeMs + opts.leadMs + opts.click(i, b.timeMs), RATE, b.beat === 0)
    })
  }
  const cut = Math.round(((opts.cutMs ?? 0) / 1000) * RATE)
  return out.subarray(cut)
}

describe('analyzeSyncRecording (#464)', () => {
  it('finds a constant offset: click 90 ms before the track, on every beat', () => {
    const rec = record({ leadMs: 3456, track: () => 0, click: () => -90 })
    const report = analyzeSyncRecording(song, rec, rec, RATE)
    expect(report.trackStartMs).toBeCloseTo(3456, -1)
    expect(report.overall.pairs).toBe(song.beats.filter((b) => !b.silent).length)
    expect(report.overall.medianMs).toBeCloseTo(-90, 0)
    expect(report.overall.sdMs!).toBeLessThan(1)
    expect(report.overall.trackJumps).toBe(0)
    // Every section, the ritardando and the tempo jumps included.
    for (const s of report.sections) expect(Math.abs(s.medianMs! + 90)).toBeLessThan(1.5)
  })

  it('a click after the track and a beat-by-beat jitter are measured exactly', () => {
    const jitter = (i: number) => ((i * 37) % 11) - 5 // -5…+5 ms, known per beat
    const rec = record({ leadMs: 2000, track: () => 0, click: (i) => 40 + jitter(i) })
    const report = analyzeSyncRecording(song, rec, rec, RATE)
    const audible = song.beats.map((b, i) => ({ b, i })).filter(({ b }) => !b.silent)
    audible.forEach(({ i }, k) => expect(Math.abs(report.beats[k]!.clickMinusTrackMs! - (40 + jitter(i)))).toBeLessThan(1))
  })

  it('follows a track that falls behind and is pulled back (the sawtooth on main) and counts the jumps', () => {
    // Behind by 35 ms per second, reset at 200 ms - like the Xiaomi on main (2026-10-09).
    const saw = (ms: number) => -((ms * 0.035) % 200)
    const rec = record({ leadMs: 2500, track: (_i, ms) => saw(ms), click: () => 0 })
    const report = analyzeSyncRecording(song, rec, rec, RATE)
    const expectedJumps = song.beats.filter((b, i) => i > 0 && !b.silent && !song.beats[i - 1]!.silent && saw(b.timeMs) - saw(song.beats[i - 1]!.timeMs) > 40).length
    expect(report.overall.trackJumps).toBe(expectedJumps)
    expect(report.overall.trackJumps).toBeGreaterThan(15)
    // Click minus track = minus the sawtooth, on each beat.
    for (const b of report.beats.filter((x) => x.clickMinusTrackMs !== null).slice(0, 40)) expect(Math.abs(b.clickMinusTrackMs! + saw(b.songMs))).toBeLessThan(1)
  })

  it('two devices: track on one channel, click on the other', () => {
    const track = record({ leadMs: 1000, track: () => 25, click: () => 0, clicks: false })
    const click = record({ leadMs: 1000, track: () => 0, click: () => 140, beeps: false })
    const report = analyzeSyncRecording(song, track, click, RATE)
    expect(report.overall.medianMs).toBeCloseTo(115, 0)
  })

  it('a recording that starts in the middle of the song still finds the right beats', () => {
    const rec = record({ leadMs: 0, track: () => 0, click: () => -30, cutMs: 40000 })
    const report = analyzeSyncRecording(song, rec, rec, RATE)
    expect(report.trackStartMs).toBeCloseTo(-40000, -1)
    expect(report.overall.medianMs).toBeCloseTo(-30, 0)
    expect(report.sections.find((s) => s.section === 'steady')!.pairs).toBeLessThan(20) // only its end was recorded
    expect(report.sections.find((s) => s.section === 'ending')!.pairs).toBe(16)
  })

  it('reads its own WAV back', () => {
    const rec = record({ leadMs: 500, track: () => 0, click: () => 0 })
    const { rate, channels } = decodeWav(encodeWav(rec, RATE))
    expect(rate).toBe(RATE)
    expect(channels).toHaveLength(1)
    expect(Math.abs(channels[0]![1000]! - rec[1000]!)).toBeLessThan(1e-4)
  })
})
