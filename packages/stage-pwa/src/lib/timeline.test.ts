import { describe, expect, it } from 'vitest'
import type { BeatAnchor } from 'shared-types'
import {
  barQuality,
  beatsAreGrabbable,
  clampView,
  formatTimelineTime,
  hitBeat,
  nudgeAnchor,
  pinBeat,
  setDownbeat,
  snapTime,
  timeToX,
  xToTime,
  zoomAround,
} from './timeline'

const grid = Array.from({ length: 16 }, (_, i) => ({ timeMs: 1000 + i * 500, beatInBar: i % 4 }))

describe('view', () => {
  it('converts between time and pixels', () => {
    const view = { startMs: 1000, msPerPx: 10 }
    expect(timeToX(3000, view)).toBe(200)
    expect(xToTime(200, view)).toBe(3000)
  })

  it('zooms around the point under the finger', () => {
    const view = { startMs: 0, msPerPx: 10 }
    const zoomed = zoomAround(view, 0.5, 300)
    expect(zoomed.msPerPx).toBe(5)
    expect(xToTime(300, zoomed)).toBe(xToTime(300, view))
  })

  it('keeps the view on the song', () => {
    expect(clampView({ startMs: -60000, msPerPx: 10 }, 1000, -4000, 200000).startMs).toBe(-5000)
    // 10 s visible, margin 10 % of that.
    expect(clampView({ startMs: 500000, msPerPx: 10 }, 1000, -4000, 200000).startMs).toBe(191000)
  })
})

describe('snapping and hit-testing', () => {
  it('snaps to the nearest bar or beat, or not at all', () => {
    expect(snapTime(2700, grid, 'bar')).toBe(3000)
    expect(snapTime(2700, grid, 'beat')).toBe(2500)
    expect(snapTime(2700, grid, 'off')).toBe(2700)
  })

  it('finds the grid line under the finger within the tolerance', () => {
    const view = { startMs: 0, msPerPx: 10 }
    expect(hitBeat(151, grid, view, 24, false)).toBe(1) // 1500 ms at x = 150
    expect(hitBeat(151, grid, view, 24, true)).toBe(-1) // not a downbeat
    expect(hitBeat(310, grid, view, 24, true)).toBe(4) // 3000 ms, bar 2
  })

  it('offers single beats only when they are at least a finger apart', () => {
    expect(beatsAreGrabbable(500, { startMs: 0, msPerPx: 10 })).toBe(true)
    expect(beatsAreGrabbable(500, { startMs: 0, msPerPx: 40 })).toBe(false)
  })
})

describe('barQuality', () => {
  it('colours bars by how many beats sit on an onset', () => {
    const onsets = [1000, 1510, 2020, 2500, 3100, 3700, 4600]
    const bars = barQuality(grid.slice(0, 12), onsets)
    expect(bars.map((b) => b.level)).toEqual(['good', 'poor', 'quiet'])
  })
})

describe('grid edits', () => {
  const anchors: BeatAnchor[] = grid.map((b, i) => ({ id: `a${i}`, timeMs: b.timeMs + 20, beatInBar: b.beatInBar }))

  it('drags a bar line: one fixed anchor replaces the anchors of that beat', () => {
    const next = pinBeat(anchors, 3000, 2980, 0, 500)
    expect(next.filter((a) => Math.abs(a.timeMs - 3000) < 250)).toEqual([expect.objectContaining({ timeMs: 2980, beatInBar: 0, pinned: true })])
    expect(next).toHaveLength(anchors.length)
  })

  it('sets beat 1 and renumbers older fixed anchors to agree', () => {
    const withPin = pinBeat(anchors, 5000, 5000, 0, 500) // an older fixed anchor on grid beat 8
    const next = setDownbeat(withPin, grid, 2, '4/4') // grid beat 2 becomes beat 1
    const older = next.find((a) => a.pinned && a.timeMs === 5000)!
    expect(older.beatInBar).toBe(2) // beat 8 is now 6 beats after the new beat 1
    expect(next.find((a) => a.pinned && a.timeMs === 2000)?.beatInBar).toBe(0)
  })

  it('nudging an anchor fixes it in place', () => {
    const next = nudgeAnchor(anchors, 'a3', -10)
    expect(next.find((a) => a.id === 'a3')).toEqual(expect.objectContaining({ timeMs: 2510, pinned: true }))
  })
})

describe('formatTimelineTime', () => {
  it('shows tenths, and the count-in as negative', () => {
    expect(formatTimelineTime(83_450)).toBe('1:23.5')
    expect(formatTimelineTime(-2_000)).toBe('-0:02.0')
  })
})
