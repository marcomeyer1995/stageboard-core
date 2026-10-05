import { describe, expect, it } from 'vitest'
import { clickLayout, lineHeightFor, nextSongLayout, tempoLayout, transportLayout } from './gigWidgetLayout'

// Content boxes measured on the band's Fire tablet (800 x 1280 portrait, 1280 x 800 landscape),
// widget size minus the frame's padding.
describe('transportLayout (Show-Transport)', () => {
  const info = lineHeightFor(24)

  it('stacks info over four buttons in a row at the new portrait default (6 x 4)', () => {
    expect(transportLayout(350, 163, info)).toMatchObject({ row: false, columns: 4, showTitle: true, showHelper: true, compactInfo: false })
  })

  it('uses a 2 x 2 grid when too narrow for four readable buttons in a row', () => {
    expect(transportLayout(300, 200, info)).toMatchObject({ row: false, columns: 2 })
  })

  it('puts info and buttons side by side in a flat, wide tile (measured: landscape 6 x 4, 49px info)', () => {
    // Stacked, the buttons were 16px tall on the tablet; side by side they get the full 73px.
    expect(transportLayout(599, 73, 49)).toMatchObject({ row: true, columns: 4, showTitle: true, showHelper: false, compactInfo: false })
  })

  it('keeps only the running time beside the buttons when a flat tile is narrow (measured: 387 x 46)', () => {
    // "Prompter Kopie" in landscape: stacked buttons came out 1px tall.
    expect(transportLayout(387, 46, info)).toMatchObject({ row: true, showTitle: false })
  })

  it('prefers side by side whenever that gives the buttons a larger smallest side (measured: 281 x 74)', () => {
    expect(transportLayout(281, 74, info)).toMatchObject({ row: true, showTitle: false })
  })

  it('drops helper lines before stacked buttons fall below touch height', () => {
    expect(transportLayout(350, 110, info).showHelper).toBe(false)
  })

  it('renders the roomy layout while unmeasured', () => {
    expect(transportLayout(0, 0, info)).toMatchObject({ row: false, columns: 4, showTitle: true, showHelper: true, compactInfo: false })
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
    expect(clickLayout(158, 119, 40)).toMatchObject({ row: false, showLabel: false, shortLabels: true })
  })

  it('puts state and buttons side by side in the flat landscape tile', () => {
    expect(clickLayout(278, 67, 40)).toMatchObject({ row: true, showLabel: false, shortLabels: true })
  })
})

describe('tempoLayout (Tempo-Korrektur)', () => {
  it('shows the label when there is room, and resets via the value when a reset button would not fit', () => {
    expect(tempoLayout(119)).toEqual({ showLabel: true, resetAsButton: false })
    expect(tempoLayout(67)).toEqual({ showLabel: false, resetAsButton: false })
    expect(tempoLayout(200)).toEqual({ showLabel: true, resetAsButton: true })
  })
})

describe('compact widgets on a phone (#369 follow-up: dashboards never scroll)', () => {
  it('transport buttons narrower than their words show icons', () => {
    // Phone "Prompter Kopie": 239 x 89 px - four words squeezed into each other before.
    expect(transportLayout(239, 89, 40).iconButtons).toBe(true)
    // A roomy landscape tile keeps the words.
    expect(transportLayout(737, 83, 40).iconButtons).toBe(false)
  })

  it('a small Klick widget drops the big state word; the highlighted button shows the state', () => {
    // Phone: 177 x 57 px - stacked state + 56 px buttons did not fit, the buttons were cut.
    expect(clickLayout(177, 57, 40)).toMatchObject({ row: false, showState: false })
    expect(clickLayout(158, 160, 40).showState).toBe(true)
    expect(clickLayout(278, 67, 40)).toMatchObject({ row: true, showState: true })
  })
})

