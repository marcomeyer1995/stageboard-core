/**
 * What the status bar can show besides its fixed core (☰, state icon, song title, elapsed time),
 * and in which order it gives them up when room runs out (Marco, 2026-10-07: fixed screen-width
 * breakpoints hid the clock and the song length on the Xiaomi while "GIG" stayed - now a ranked
 * list, adjustable per device in Einstellungen).
 */
export const STATUS_BAR_ITEMS = ['duration', 'master', 'clock', 'stateText', 'sync', 'mode', 'profile', 'screen', 'syncText'] as const
export type StatusBarItem = (typeof STATUS_BAR_ITEMS)[number]

/** Default ranking: most important first - dropped from the end. */
export const DEFAULT_STATUS_BAR_ORDER: readonly StatusBarItem[] = STATUS_BAR_ITEMS

export const STATUS_BAR_ITEM_LABEL: Record<StatusBarItem, string> = {
  duration: 'Songlänge',
  master: 'Master-Krone',
  clock: 'Uhrzeit',
  stateText: 'Status als Wort (Spielt, Pause …)',
  sync: 'Sync-Symbol',
  mode: 'Gig / Solo',
  profile: 'Dein Name',
  screen: 'Ansicht neben ☰',
  syncText: 'Sync als Wort',
}

/** The song title keeps at least this much room (px) - items drop until it has it. */
export const STATUS_BAR_MIN_TITLE_PX = 160

/**
 * Which items fit: walks the ranking and keeps each item whose width still leaves the title its
 * minimum. `room` is the width title and items share; widths include the gap. An item that is
 * not there right now (no Master, no profile) has width 0 and costs nothing. Skipping an item
 * that doesn't fit and keeping a smaller one after it would make the bar jump around - so the
 * first item that doesn't fit ends the list.
 */
export function fitStatusBarItems(order: readonly StatusBarItem[], widths: Partial<Record<StatusBarItem, number>>, room: number, minTitle = STATUS_BAR_MIN_TITLE_PX): Set<StatusBarItem> {
  const shown = new Set<StatusBarItem>()
  let left = room - minTitle
  for (const item of order) {
    const width = widths[item] ?? 0
    if (width > left) break
    left -= width
    shown.add(item)
  }
  return shown
}

/** A stored ranking brought up to date: unknown ids dropped, items added later appended. */
export function normalizeStatusBarOrder(stored: readonly string[] | undefined): StatusBarItem[] {
  const known = (stored ?? []).filter((id): id is StatusBarItem => (STATUS_BAR_ITEMS as readonly string[]).includes(id))
  return [...new Set([...known, ...DEFAULT_STATUS_BAR_ORDER])]
}
