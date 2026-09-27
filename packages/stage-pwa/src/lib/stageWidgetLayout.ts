import { GAP, LINE, TOUCH, lineHeightFor } from './gigWidgetLayout'

/**
 * Size-dependent layouts for the remaining widgets (PR D of the stage GUI audit, 2026-09-27) -
 * same rules as gigWidgetLayout.ts: pure functions over the measured box, the key readout keeps
 * its configured size, and secondary information gives way in discrete steps (seconds, captions,
 * hints) instead of the text shrinking (font auto-fit was tried and rejected, 2026-09-14).
 *
 * Unmeasured boxes (0 x 0) get the roomy layout, which is what the widgets rendered before.
 */

/** Width of one tabular digit / letter, and of a ":" or ".", in em - slightly generous, so a
 * readout that "just fits" by the estimate really fits. Monospace text uses DIGIT_EM for every
 * character. */
const DIGIT_EM = 0.6
const SEPARATOR_EM = 0.3

/** Estimated rendered width of a time readout like "21:05:09" or "05:09.123", px. */
export function readoutWidth(text: string, fontSize: number, mono = false): number {
  let em = 0
  for (const char of text) em += !mono && (char === ':' || char === '.') ? SEPARATOR_EM : DIGIT_EM
  return em * fontSize
}

/** The gap of Tailwind gap-1, used between the stacked lines of the readout widgets. */
const LINE_GAP = 4

export interface ClockLayout {
  showSeconds: boolean
}

/** Uhr: the seconds go first when "HH:MM:SS" at the configured size is wider than the widget
 * (found on the tablet: a default 3 x 3 clock cut to "2:21:2"). */
export function clockLayout(width: number, fontSize: number): ClockLayout {
  if (width <= 0) return { showSeconds: true }
  return { showSeconds: readoutWidth('00:00:00', fontSize) <= width }
}

export interface FestivalClockLayout {
  /** The "Voraussichtliches Ende" caption above the time. */
  showCaption: boolean
  /** The "n Songs geschätzt" line under the target line. */
  showEstimate: boolean
}

/** Festival-Uhr: predicted end time first, then the target/buffer line, then the caption, then
 * the estimate note. */
export function festivalClockLayout(height: number, timeFont: number): FestivalClockLayout {
  if (height <= 0) return { showCaption: true, showEstimate: true }
  const base = lineHeightFor(timeFont) + LINE_GAP + LINE
  const showCaption = height >= base + LINE_GAP + LINE
  const showEstimate = height >= base + (showCaption ? 2 : 1) * (LINE_GAP + LINE)
  return { showCaption, showEstimate }
}

export type SyncClockFormat = 'full' | 'minutes' | 'seconds'

export interface SyncCheckLayout {
  /** "HH:MM:SS.mmm", "MM:SS.mmm" or "SS.mmm" - the seconds and milliseconds are what two
   * devices are compared by, so the hours and then the minutes give way first. */
  clock: SyncClockFormat
  showOffset: boolean
  showCaption: boolean
}

export const SYNC_CLOCK_SAMPLE: Record<SyncClockFormat, string> = {
  full: '00:00:00.000',
  minutes: '00:00.000',
  seconds: '00.000',
}

/** Sync-Check: widest clock format that fits, then the offset/drift line, then the caption. */
export function syncCheckLayout(width: number, height: number, fontSize: number): SyncCheckLayout {
  if (width <= 0 || height <= 0) return { clock: 'full', showOffset: true, showCaption: true }
  const available = width - 2 * GAP
  const clock: SyncClockFormat =
    readoutWidth(SYNC_CLOCK_SAMPLE.full, fontSize, true) <= available
      ? 'full'
      : readoutWidth(SYNC_CLOCK_SAMPLE.minutes, fontSize, true) <= available
        ? 'minutes'
        : 'seconds'
  const clockLine = lineHeightFor(fontSize)
  const showOffset = height >= clockLine + LINE_GAP + LINE
  const showCaption = height >= clockLine + 2 * (LINE_GAP + LINE)
  return { clock, showOffset, showCaption }
}

export interface TrackOverrideLayout {
  /** "Variante" / "Track für …" captions above the selects. Without them each option carries
   * its own "Variante:" / "Track:" prefix, so the two selects stay distinguishable. */
  showLabels: boolean
}

/** Variante & Track: the selects keep their touch height, the captions give way. */
export function trackOverrideLayout(height: number, labelFont: number, selects: 1 | 2): TrackOverrideLayout {
  if (height <= 0) return { showLabels: true }
  const perSelect = lineHeightFor(labelFont) + GAP + TOUCH
  return { showLabels: height >= selects * perSelect + (selects - 1) * GAP }
}

export interface SwitcherLayout {
  /** Buttons wrap onto a second row instead of scrolling sideways. */
  wrap: boolean
}

/** Dashboard-Umschalter (horizontal): buttons are as wide as their names - never cut off - and
 * wrap onto further rows when the widget is tall enough for two touch-height rows, otherwise
 * the single row scrolls sideways. */
export function switcherLayout(height: number): SwitcherLayout {
  return { wrap: height >= 2 * TOUCH + GAP }
}

/** The Quintenzirkel's SVG is drawn in a 200-unit box. */
export const CIRCLE_VIEWBOX = 200
const MIN_LABEL_PX = 16
/** Label sizes in SVG units: the drawn defaults, and the most the wedges have room for. */
const CIRCLE_LABEL = { major: { base: 13, max: 18 }, minor: { base: 10.5, max: 14 } } as const

export interface CircleLabelUnits {
  major: number
  minor: number
}

/** Quintenzirkel: SVG label sizes (viewBox units) that render at the 16px stage floor for the
 * drawn size of the circle, capped at what fits in a wedge (a tiny circle keeps its capped,
 * then too-small labels - the widget's minimum size is set so that does not happen). */
export function circleLabelUnits(drawnSide: number): CircleLabelUnits {
  if (drawnSide <= 0) return { major: CIRCLE_LABEL.major.base, minor: CIRCLE_LABEL.minor.base }
  const floorUnits = MIN_LABEL_PX / (drawnSide / CIRCLE_VIEWBOX)
  const size = (ring: 'major' | 'minor') =>
    Math.min(CIRCLE_LABEL[ring].max, Math.max(CIRCLE_LABEL[ring].base, floorUnits))
  return { major: size('major'), minor: size('minor') }
}
