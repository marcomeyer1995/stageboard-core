import { describe, expect, it } from 'vitest'
import {
  circleLabelUnits,
  clockLayout,
  festivalClockLayout,
  readoutWidth,
  switcherLayout,
  syncCheckLayout,
  trackOverrideLayout,
} from './stageWidgetLayout'

// Sizes measured on the band's Fire tablet (800 x 1280 portrait) at the audit's device text size
// (15px), widget content boxes.
describe('readoutWidth', () => {
  it('counts separators narrower than digits, except in monospace', () => {
    expect(readoutWidth('00:00', 10)).toBeCloseTo(27)
    expect(readoutWidth('00:00', 10, true)).toBeCloseTo(30)
  })
})

describe('clockLayout (Uhr)', () => {
  it('drops the seconds in the old 3 x 3 default (157px wide, 45px digits - showed "2:21:2")', () => {
    expect(clockLayout(157, 45)).toEqual({ showSeconds: false })
  })

  it('keeps the seconds at the new 4 x 3 default (223px)', () => {
    expect(clockLayout(223, 45)).toEqual({ showSeconds: true })
  })

  it('keeps the seconds while unmeasured', () => {
    expect(clockLayout(0, 45)).toEqual({ showSeconds: true })
  })
})

describe('festivalClockLayout (Festival-Uhr)', () => {
  it('drops the caption and the estimate note in the 4 x 3 default (103px tall, content clipped)', () => {
    expect(festivalClockLayout(103, 38)).toEqual({ showCaption: false, showEstimate: false })
  })

  it('shows the caption before the estimate note', () => {
    expect(festivalClockLayout(110, 38)).toEqual({ showCaption: true, showEstimate: false })
    expect(festivalClockLayout(140, 38)).toEqual({ showCaption: true, showEstimate: true })
  })
})

describe('syncCheckLayout (Sync-Check)', () => {
  it('drops the hours, the caption and the offset line in the 3 x 3 default (190 x 136, 30px digits)', () => {
    expect(syncCheckLayout(190, 136, 30)).toEqual({ clock: 'minutes', showOffset: true, showCaption: true })
    expect(syncCheckLayout(190, 80, 30)).toEqual({ clock: 'minutes', showOffset: true, showCaption: false })
    expect(syncCheckLayout(190, 50, 30)).toEqual({ clock: 'minutes', showOffset: false, showCaption: false })
  })

  it('keeps only seconds and milliseconds when even minutes do not fit', () => {
    expect(syncCheckLayout(140, 136, 30).clock).toBe('seconds')
  })

  it('shows the full clock in a wide tile', () => {
    expect(syncCheckLayout(400, 136, 30).clock).toBe('full')
  })
})

describe('trackOverrideLayout (Variante & Track)', () => {
  it('drops the captions when two touch-height selects fill the 3 x 3 default (103px)', () => {
    expect(trackOverrideLayout(103, 16, 2)).toEqual({ showLabels: false })
  })

  it('keeps the caption above a single select', () => {
    expect(trackOverrideLayout(103, 16, 1)).toEqual({ showLabels: true })
  })

  it('keeps the captions when both pairs fit', () => {
    expect(trackOverrideLayout(200, 16, 2)).toEqual({ showLabels: true })
  })
})

describe('switcherLayout (Dashboard-Umschalter)', () => {
  it('scrolls a single row in the 12 x 2 default (55px) and wraps from two touch rows up', () => {
    expect(switcherLayout(55)).toEqual({ wrap: false })
    expect(switcherLayout(120)).toEqual({ wrap: true })
  })
})

describe('circleLabelUnits (Quintenzirkel)', () => {
  it('raises the labels to the 16px floor for the drawn size', () => {
    // At the old 4 x 7 default (222px circle) 13 / 10.5 units rendered at 14.4 / 11.7px; the new
    // 6 x 10 default draws the circle at about 330px, the 4-column minimum at about 250px.
    for (const side of [250, 330]) {
      const units = circleLabelUnits(side)
      expect(units.major * (side / 200)).toBeGreaterThanOrEqual(16)
      expect(units.minor * (side / 200)).toBeGreaterThanOrEqual(16)
    }
  })

  it('keeps the drawn sizes when the circle is large', () => {
    expect(circleLabelUnits(400)).toEqual({ major: 13, minor: 10.5 })
  })

  it('caps the labels at what fits a wedge', () => {
    expect(circleLabelUnits(100)).toEqual({ major: 18, minor: 14 })
  })
})
