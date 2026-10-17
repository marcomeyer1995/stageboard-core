import { describe, expect, it } from 'vitest'
import { clickTimeline } from './beatGrid'
import { gridReleaseAt } from './gridRelease'
import type { TransportState } from './playbackTransport'

// 120 bpm 4/4: a beat every 500 ms, a bar every 2 s. Started at server time 0, so song time = server time.
const timeline = clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 0 })
const playing: TransportState = { status: 'playing', startedAt: 0, accumulatedMs: 0, jump: null }

describe('gridReleaseAt - "auf den Takt" (docs/23 §4a)', () => {
  it('counts from the nearest bar line: pressed just after or just before it, the release lands on a bar line', () => {
    expect(gridReleaseAt(timeline, playing, 2_100, 2, 'bars')).toBe(6_000)
    expect(gridReleaseAt(timeline, playing, 3_900, 2, 'bars')).toBe(8_000)
  })

  it('beats the same way', () => {
    expect(gridReleaseAt(timeline, playing, 1_300, 2, 'beats')).toBe(2_500)
    expect(gridReleaseAt(timeline, playing, 1_100, 2, 'beats')).toBe(2_000)
  })

  it('follows a section jump queued before the target: the rest is counted on from where it lands', () => {
    // Pressed at 2.1 s for 2 bars; at 4 s the song jumps to 16 s - one bar before, one bar after.
    const jumping: TransportState = { ...playing, jump: { at: 4_000, toMs: 16_000 } }
    expect(gridReleaseAt(timeline, jumping, 2_100, 2, 'bars')).toBe(6_000)
    // 3 bars: two after the jump, landing on song 20 s = server 8 s.
    expect(gridReleaseAt(timeline, jumping, 2_100, 3, 'bars')).toBe(8_000)
  })

  it('nothing to land on while the song is not playing', () => {
    expect(gridReleaseAt(timeline, { status: 'paused', startedAt: null, accumulatedMs: 5_000, jump: null }, 9_000, 2, 'bars')).toBeNull()
  })
})
