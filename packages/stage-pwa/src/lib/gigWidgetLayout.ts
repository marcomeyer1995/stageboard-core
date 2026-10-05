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
  /** Info left, buttons right at full height - for flat widgets, where stacking the info
   * above would squeeze the buttons. */
  row: boolean
  /** 4 = Play/Pause/Stop/Reset in one row, 2 = a 2 x 2 grid (stacked layout only). */
  columns: 2 | 4
  /** The song title next to the time. Gives way first: in a narrow side-by-side layout only
   * the running time stays. */
  showTitle: boolean
  /** The "Audio läuft über ein anderes Gerät" style helper lines (errors always show). */
  showHelper: boolean
  /** Title and time at the 24px readout minimum instead of the configured size - one discrete
   * step when a full-size info line would squeeze stacked buttons. */
  compactInfo: boolean
  /** Play/Pause/Stop/Reset as icons: the buttons are narrower than their words (#369 follow-up -
   * a phone's 239 px transport squeezed "PLAY PAUSE STOP RESET" into each other). */
  iconButtons: boolean
}

/** Narrower than this, a transport button shows its icon instead of its word, px. */
export const TRANSPORT_WORD_MIN = 88

/** Width of the info block beside the buttons: with the title / time only, px. */
const TRANSPORT_INFO_WITH_TITLE = 200
const TRANSPORT_INFO_TIME_ONLY = 96

/**
 * Show-Transport. Scores the candidate layouts by their buttons' smallest side and takes the
 * best, instead of fixed thresholds (found live on the tablet, 2026-09-27: flat widgets of
 * 599 x 73 and 387 x 46 left stacked buttons 16px and 1px tall under the info line):
 * - stacked: info above, four buttons in a row, or 2 x 2 when too narrow for 80px buttons;
 *   the info drops to the 24px readout minimum if its configured size would squeeze them;
 * - side by side: info left (title and time, or the time alone when narrow - the title gives
 *   way first), four buttons right at the full widget height.
 * Ties go to stacked. Helper lines only while stacked buttons keep their touch height.
 */
export function transportLayout(width: number, height: number, infoHeight: number): TransportLayout {
  if (unmeasured(width, height)) {
    return { row: false, columns: 4, showTitle: true, showHelper: true, compactInfo: false, iconButtons: false }
  }
  const compactHeight = lineHeightFor(READOUT_MIN)
  const fullArea = height - infoHeight - GAP
  const compactInfo = fullArea < TOUCH && infoHeight > compactHeight
  const buttonsArea = compactInfo ? height - compactHeight - GAP : fullArea

  let columns: 2 | 4 = width >= 4 * 80 + 3 * GAP ? 4 : 2
  if (columns === 2 && buttonsArea < 2 * 48 + GAP && width >= 4 * TOUCH + 3 * GAP) columns = 4
  const stackedSide =
    columns === 4
      ? Math.min((width - 3 * GAP) / 4, buttonsArea)
      : Math.min((width - GAP) / 2, (buttonsArea - GAP) / 2)

  const showTitle = width - TRANSPORT_INFO_WITH_TITLE - GAP >= 4 * TOUCH_PRIMARY + 3 * GAP
  const rowButtonsWidth = width - (showTitle ? TRANSPORT_INFO_WITH_TITLE : TRANSPORT_INFO_TIME_ONLY) - GAP
  const rowSide = Math.min((rowButtonsWidth - 3 * GAP) / 4, height)

  if (rowSide > stackedSide) {
    const buttonWidth = (rowButtonsWidth - 3 * GAP) / 4
    return { row: true, columns: 4, showTitle, showHelper: false, compactInfo: false, iconButtons: buttonWidth < TRANSPORT_WORD_MIN }
  }
  const rows = columns === 4 ? 1 : 2
  const perRowWithHelper = (buttonsArea - LINE - GAP - (rows - 1) * GAP) / rows
  const buttonWidth = columns === 4 ? (width - 3 * GAP) / 4 : (width - GAP) / 2
  return { row: false, columns, showTitle: true, showHelper: perRowWithHelper >= TOUCH, compactInfo, iconButtons: buttonWidth < TRANSPORT_WORD_MIN }
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
  /** The big "An"/"Aus" word. Gives way only when neither stacked nor side by side fits it (a
   * small widget on a phone): the highlighted button then shows the state on its own. */
  showState: boolean
}

export function clickLayout(width: number, height: number, stateFont: number): ClickLayout {
  if (unmeasured(width, height)) return { row: false, showLabel: true, shortLabels: false, showState: true }
  const state = lineHeightFor(stateFont)
  const tooFlatToStack = height < state + GAP + TOUCH
  const row = tooFlatToStack && width >= 260
  if (row) return { row, showLabel: false, shortLabels: width < 480, showState: true }
  return {
    row,
    showLabel: height >= LINE + GAP + state + GAP + TOUCH,
    shortLabels: width < 300,
    showState: !tooFlatToStack,
  }
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
