import { describe, expect, it } from 'vitest'
import { clickLayout, lineHeightFor, nextSongLayout, tempoLayout, transportLayout } from './gigWidgetLayout'

// Content boxes measured on the band's Fire tablet (800 x 1280 portrait, 1280 x 800 landscape),
// widget size minus the frame's padding.
describe('transportLayout (Show-Transport)', () => {
  const info = lineHeightFor(24)

  it('puts all four buttons in one row at the new default size, in both orientations', () => {
    expect(transportLayout(350, 163, info)).toEqual({ columns: 4, showHelper: true }) // portrait 6 x 4
    expect(transportLayout(600, 100, info).columns).toBe(4) // landscape 6 x 4
  })

  it('drops helper lines before the buttons fall below touch height - the time stays regardless', () => {
    expect(transportLayout(600, 100, info).showHelper).toBe(false)
  })

  it('uses a 2 x 2 grid when too narrow for four readable buttons in a row', () => {
    expect(transportLayout(300, 200, info).columns).toBe(2)
  })

  it('renders the roomy layout while unmeasured', () => {
    expect(transportLayout(0, 0, info)).toEqual({ columns: 4, showHelper: true })
  })
})

describe('nextSongLayout (Next Song)', () => {
  const line = lineHeightFor(18)

  it('stacks info over a full-width button row in a narrow but tall widget (portrait 7 x 3)', () => {
    expect(nextSongLayout(422, 119, line)).toEqual({ stacked: true, twoLines: true, shortLabels: false })
  })

  it('keeps buttons beside the info with two info lines when flat and wide (landscape 7 x 3)', () => {
    expect(nextSongLayout(734, 67, line)).toEqual({ stacked: false, twoLines: true, shortLabels: false })
  })

  it('switches to short labels when full labels would leave the song names no room', () => {
    expect(nextSongLayout(454, 66, line).shortLabels).toBe(true)
  })
})

describe('clickLayout (Klick)', () => {
  it('stacks state over buttons in portrait 3 x 3 and hides the label rather than the buttons', () => {
    expect(clickLayout(158, 119, 40)).toEqual({ row: false, showLabel: false, shortLabels: true })
  })

  it('puts state and buttons side by side in the flat landscape tile', () => {
    expect(clickLayout(278, 67, 40)).toEqual({ row: true, showLabel: false, shortLabels: true })
  })
})

describe('tempoLayout (Tempo-Korrektur)', () => {
  it('shows the label when there is room, and resets via the value when a reset button would not fit', () => {
    expect(tempoLayout(119)).toEqual({ showLabel: true, resetAsButton: false })
    expect(tempoLayout(67)).toEqual({ showLabel: false, resetAsButton: false })
    expect(tempoLayout(200)).toEqual({ showLabel: true, resetAsButton: true })
  })
})
