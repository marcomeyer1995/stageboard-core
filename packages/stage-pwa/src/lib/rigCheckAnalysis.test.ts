import { describe, expect, it } from 'vitest'
import { analysisCheck, ANALYSIS_SAMPLE_RATE, scoreGrid } from './rigCheckAnalysis'
import { buildRigCheckSong, synthesizeRigCheckTrack } from './rigCheckSong'

const full = buildRigCheckSong('full')

describe('Rig-Check analysis check (#464, docs/24 §6)', () => {
  it('the song\'s own grid scores perfect - except the known limit inside a bar', () => {
    const score = scoreGrid(full, full.grid, full.bpm, full.timeSignature)
    for (const s of score.sections) {
      if (s.knownLimit === 'silent') expect(s.beats).toBe(0)
      else if (s.knownLimit === 'change-in-bar') expect(s.hitRate).toBeLessThan(1)
      else expect(s, s.name).toMatchObject({ hitRate: 1, slipRate: 0 })
      expect(s.slipRate).toBe(0)
    }
    expect(score.bpm).toBe(120)
  })

  it('a grid at half tempo lands on every other drum hit and counts the bars wrong', () => {
    const quick = buildRigCheckSong('quick')
    const score = scoreGrid(quick, { points: [{ id: 'a', bar: 1, timeMs: 2000 }], meters: [] }, 60, '4/4')
    const steady = score.sections.find((s) => s.name === 'steady')!
    expect(steady.hitRate).toBeCloseTo(0.5, 1)
    expect(steady.slipRate).toBeGreaterThan(0.9)
  })

  // A guard for the analysis itself: "Verfeinern" must keep the click on the drums where the tempo
  // is steady. The sections with tempo changes are its known weakness (2026-10-27 baseline in the
  // PR) - they are reported, not asserted.
  it.each(['quick', 'full'] as const)('Verfeinern keeps steady 120 on the drums (%s)', (kind) => {
    const song = buildRigCheckSong(kind)
    const check = analysisCheck(song, synthesizeRigCheckTrack(song, ANALYSIS_SAMPLE_RATE), ANALYSIS_SAMPLE_RATE)
    const steady = check.refine!.sections.find((s) => s.name === 'steady')!
    expect(steady.hitRate).toBeGreaterThanOrEqual(0.95)
    expect(steady.slipRate).toBe(0)
    expect(check.detect).not.toBeNull()
  }, 30_000)
})
