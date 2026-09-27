import { describe, expect, it } from 'vitest'
import { barQuality, clampView, barLabelEvery, formatTimelineTime, nextProblemBar, tokenColor, timeToX, xToTime, zoomAround } from './timeline'

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

describe('barQuality', () => {
  it('colours bars by how many beats sit on an onset', () => {
    const onsets = [1000, 1510, 2020, 2500, 3100, 3700, 4600]
    const bars = barQuality(grid.slice(0, 12), onsets)
    expect(bars.map((b) => b.level)).toEqual(['good', 'poor', 'quiet'])
  })
})

describe('nextProblemBar', () => {
  const bar = (startMs: number, level: 'good' | 'ok' | 'poor' | 'quiet') => ({ startMs, endMs: startMs + 2000, share: 0, level })
  it('jumps to the next red bar, wrapping around', () => {
    const bars = [bar(0, 'poor'), bar(2000, 'ok'), bar(4000, 'good'), bar(6000, 'poor')]
    expect(nextProblemBar(bars, 100)?.startMs).toBe(6000)
    expect(nextProblemBar(bars, 6000)?.startMs).toBe(0)
  })
  it('falls back to orange bars, and to nothing when all is fine', () => {
    expect(nextProblemBar([bar(0, 'good'), bar(2000, 'ok')], 0)?.startMs).toBe(2000)
    expect(nextProblemBar([bar(0, 'good'), bar(2000, 'quiet')], 0)).toBeNull()
  })
})

describe('formatTimelineTime', () => {
  it('shows tenths, and the count-in as negative', () => {
    expect(formatTimelineTime(83_450)).toBe('1:23.5')
    expect(formatTimelineTime(-2_000)).toBe('-0:02.0')
  })
})

describe('tokenColor', () => {
  it('turns the app\'s bare channel tokens into canvas colours', () => {
    // A canvas silently ignores "255 255 255" - on the tablet nothing was drawn.
    expect(tokenColor(' 255 255 255', '#fff')).toBe('rgb(255 255 255)')
    expect(tokenColor('#123456', '#fff')).toBe('#123456')
    expect(tokenColor('', '#fff')).toBe('#fff')
  })
})

describe('barLabelEvery', () => {
  it('labels fewer bars the closer they are on screen', () => {
    expect(barLabelEvery(80)).toBe(1)
    expect(barLabelEvery(20)).toBe(2)
    expect(barLabelEvery(8)).toBe(8)
  })
})
