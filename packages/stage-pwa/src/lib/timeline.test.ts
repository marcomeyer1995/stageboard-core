import { describe, expect, it } from 'vitest'
import { barQuality, clampView, laneLayout, barLabelEvery, formatTimelineTime, minimapGrab, minimapTime, minimapX, nextProblemBar, tokenColor, timeToX, wrapText, xToTime, zoomAround } from './timeline'

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

describe('wrapText', () => {
  const measure = (s: string) => s.length * 10 // 10 px per character

  it('wraps a lyric word by word into rows that fit', () => {
    expect(wrapText('And I say hey what is going on', 120, 5, measure)).toEqual(['And I say', 'hey what is', 'going on'])
  })

  it('ends the last row in … when the text needs more rows than there are', () => {
    expect(wrapText('And I say hey what is going on', 120, 2, measure)).toEqual(['And I say', 'hey what is…'])
  })

  it('cuts a single word wider than a row, and shows nothing without room for one', () => {
    expect(wrapText('Twenty-five', 60, 3, measure)).toEqual(['Twent…'])
    expect(wrapText('Hey', 15, 3, measure)).toEqual([])
  })
})

describe('minimap (#327)', () => {
  const range = { fromMs: -2000, toMs: 98000 } // 100 s over 1000 px: 100 ms per px
  it('maps song time onto the strip and back', () => {
    expect(minimapX(-2000, range, 1000)).toBe(0)
    expect(minimapX(48000, range, 1000)).toBe(500)
    expect(minimapTime(500, range, 1000)).toBe(48000)
  })

  it('a touch outside the box centres the view there; inside it keeps the grab point', () => {
    const view = { startMs: 10000, msPerPx: 10 }
    // The lanes show 10 s (10000..20000) - touching at 70 s centres it: start 65 s.
    expect(minimapGrab(720, range, 1000, view, 10000)).toEqual({ startMs: 65000, grabMs: 5000 })
    // Grabbing the box 2 s from its left edge keeps that point under the finger.
    const inside = minimapGrab(140, range, 1000, view, 10000)
    expect(inside.startMs).toBeCloseTo(10000)
    expect(inside.grabMs).toBeCloseTo(2000)
  })
})

describe('laneLayout (#328)', () => {
  const sizes = { sectionH: 26, partsH: 28, notesH: 44, cueH: 44, defaultAudioH: 96, defaultGridH: 84, defaultTextH: 64 }

  it('stacks all lanes; full screen shares the rest 40/38/22 and fills it exactly', () => {
    const l = laneLayout(1100, new Set(), sizes)
    expect([l.audioH, l.gridH, l.textH]).toEqual([383, 364, 211])
    expect(l.cueTop + l.cueH).toBe(1100)
    expect([l.gridTop, l.textTop, l.notesTop, l.cueTop]).toEqual([383, 773, 1012, 1056])
  })

  it('a hidden lane takes no space; the others share it', () => {
    const l = laneLayout(1100, new Set(['audio', 'notes'] as const), sizes)
    expect(l.audioH).toBe(0)
    expect(l.notesH).toBe(0)
    expect(l.gridTop).toBe(0)
    expect(l.gridH + l.textH).toBe(1100 - 26 - 28 - 44)
    expect(l.cueTop + l.cueH).toBe(1100)
  })

  it('without the grid the remainder goes to the last flexible lane; compact layout sums the defaults', () => {
    const l = laneLayout(500, new Set(['grid'] as const), sizes)
    expect(l.audioH + l.textH).toBe(500 - 28 - 44 - 44)
    const compact = laneLayout(null, new Set(['text', 'cues'] as const), sizes)
    expect(compact.totalH).toBe(96 + 26 + 84 + 44)
  })
})
