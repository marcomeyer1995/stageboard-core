/**
 * Size-dependent layouts for the Gig-tier show widgets (PR B of the stage GUI audit,
 * 2026-09-27). Each widget measures its own box (useElementSize) and picks a layout here - pure
 * functions, so the decisions are testable without a DOM. The rule everywhere: buttons fill the
 * space they get (a bigger widget means bigger buttons), the key readout (time, click state,
 * tempo) never gives way, and helper text goes first when space runs out. Deliberately discrete
 * layouts, not font auto-fit (tried and rejected, 2026-09-14).
 *
 * An unmeasured box (0 x 0, e.g. the first render or a test without layout) gets the roomy
 * layout, which is also what the widgets rendered before this existed.
 */

/** Gap between controls, px (Tailwind gap-2). */
export const GAP = 8
/** --sb-touch / --sb-touch-primary in px (index.css). */
export const TOUCH = 56
export const TOUCH_PRIMARY = 72
/** Smallest size for a key readout (running time, click state, tempo), px. */
export const READOUT_MIN = 24
/** Height of one small label/helper line at the 16px text floor, px. */
export const LINE = 24

function unmeasured(width: number, height: number): boolean {
  return width <= 0 || height <= 0
}

/** Height a single line of text at `fontSize` needs, px. */
export function lineHeightFor(fontSize: number): number {
  return Math.ceil(fontSize * 1.3)
}

export interface TransportLayout {
  /** 4 = Play/Pause/Stop/Reset in one row, 2 = a 2 x 2 grid. */
  columns: 2 | 4
  /** The "Audio läuft über ein anderes Gerät" style helper lines (errors always show). */
  showHelper: boolean
}

/** Show-Transport: one row of four buttons when each can be at least 80px wide, else 2 x 2 -
 * unless the height can't take two rows of real buttons, then one narrow row after all. Helper
 * lines only while the buttons keep their touch height. */
export function transportLayout(width: number, height: number, infoHeight: number): TransportLayout {
  if (unmeasured(width, height)) return { columns: 4, showHelper: true }
  const buttonsArea = height - infoHeight - GAP
  let columns: 2 | 4 = width >= 4 * 80 + 3 * GAP ? 4 : 2
  if (columns === 2 && buttonsArea < 2 * 48 + GAP && width >= 4 * TOUCH + 3 * GAP) columns = 4
  const rows = columns === 4 ? 1 : 2
  const perRowWithHelper = (buttonsArea - LINE - GAP - (rows - 1) * GAP) / rows
  return { columns, showHelper: perRowWithHelper >= TOUCH }
}

export interface NextSongLayout {
  /** Info above, buttons in a full-width row below (narrow but tall widgets). */
  stacked: boolean
  /** "Aktuell" and "Next" on their own lines, each truncated on its own. */
  twoLines: boolean
  /** "‹" / "›" / "Ready" instead of "‹ Zurück" / "Weiter ›" / "Ready-Check". */
  shortLabels: boolean
}

/** Width the three Next Song buttons need with their full labels, px. */
const NEXT_BUTTONS_FULL = 400
/** The song info needs at least this much width to show a useful part of a title. */
const NEXT_INFO_MIN = 280

export function nextSongLayout(width: number, height: number, lineHeight: number): NextSongLayout {
  if (unmeasured(width, height)) return { stacked: false, twoLines: false, shortLabels: false }
  const stacked = width < 560 && height >= 2 * lineHeight + GAP + TOUCH
  if (stacked) return { stacked, twoLines: true, shortLabels: width < NEXT_BUTTONS_FULL }
  return {
    stacked,
    twoLines: height >= 2 * lineHeight,
    shortLabels: width - NEXT_BUTTONS_FULL - GAP < NEXT_INFO_MIN,
  }
}

export interface ClickLayout {
  /** State word left, buttons right - for flat widgets (landscape). */
  row: boolean
  /** The small "Klick · dieses Gerät" label. */
  showLabel: boolean
  /** "Std." instead of "Standard". */
  shortLabels: boolean
}

export function clickLayout(width: number, height: number, stateFont: number): ClickLayout {
  if (unmeasured(width, height)) return { row: false, showLabel: true, shortLabels: false }
  const state = lineHeightFor(stateFont)
  const row = height < state + GAP + TOUCH && width >= 260
  if (row) return { row, showLabel: false, shortLabels: width < 480 }
  return { row, showLabel: height >= LINE + GAP + state + GAP + TOUCH, shortLabels: width < 300 }
}

export interface TempoLayout {
  showLabel: boolean
  /** "Zurücksetzen" as its own button; otherwise tapping the value resets. */
  resetAsButton: boolean
}

export function tempoLayout(height: number): TempoLayout {
  if (height <= 0) return { showLabel: true, resetAsButton: true }
  const showLabel = height >= LINE + GAP + TOUCH
  const used = (showLabel ? LINE + GAP : 0) + TOUCH
  return { showLabel, resetAsButton: height >= used + GAP + 48 }
}
