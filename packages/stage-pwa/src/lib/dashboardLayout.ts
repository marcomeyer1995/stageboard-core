import { BREAKPOINTS, type Breakpoint, type Dashboard, type LayoutItem } from 'shared-types'
import type { CapabilityId } from 'shared-types'
import { capabilityStatusFor, type CapabilityStatus } from './capabilities'
import type { WidgetSize } from '../widgets/registry'

/**
 * Fixed grid: 12 columns and 24 rows at every breakpoint. Row count is fixed rather than
 * derived from the content so the field always equals the visible area - see gridMetrics.
 */
export const GRID_COLUMNS = 12
export const GRID_ROWS = 24
const MAX_GAP = 8
const FALLBACK_ROW_HEIGHT = 28

export interface GridMetrics {
  rowHeight: number
  margin: number
  padding: number
}

/**
 * Pixel metrics for the fixed GRID_COLUMNS x GRID_ROWS field, sized so the whole grid
 * covers exactly the visible area and never more. Together with maxRows that is what
 * makes "a widget can never leave the screen" true by construction: react-grid-layout's
 * gridBounds constraint clamps y to 0..maxRows-h, so there is nowhere off-screen to drag
 * to - provided those rows really do fit on screen.
 *
 * The gaps scale with the container, and rowHeight has no lower bound. A fixed minimum
 * looks harmless but breaks the whole guarantee: on a short container (portrait, with the
 * edit bar wrapped over several lines) 24 rows plus 23 fixed gaps simply do not fit, the
 * grid grows past the container, and overflow:hidden cuts off exactly the widgets the
 * musician then cannot reach.
 */
export function gridMetrics(availableHeight: number): GridMetrics {
  if (availableHeight <= 0) {
    return { rowHeight: FALLBACK_ROW_HEIGHT, margin: MAX_GAP, padding: MAX_GAP }
  }

  const gap = Math.max(0, Math.min(MAX_GAP, Math.floor(availableHeight / 100)))
  const usable = availableHeight - 2 * gap - (GRID_ROWS - 1) * gap
  return {
    rowHeight: Math.max(1, Math.floor(usable / GRID_ROWS)),
    margin: gap,
    padding: gap,
  }
}

/** Total pixel height the grid occupies with the given metrics - never exceeds the container. */
export function gridHeight({ rowHeight, margin, padding }: GridMetrics): number {
  return GRID_ROWS * rowHeight + (GRID_ROWS - 1) * margin + 2 * padding
}

/**
 * Which breakpoint a width belongs to (docs/07 section 3). Derived from the measured
 * width instead of react-grid-layout's onBreakpointChange callback: that only fires on a
 * *change*, so a portrait tablet that starts in `md` would keep whatever the initial
 * state guessed - and every layout edit would be written into the wrong breakpoint.
 */
export function breakpointFor(width: number): Breakpoint {
  if (width >= 1600) return 'xl'
  if (width >= 1024) return 'lg'
  if (width >= 640) return 'md'
  return 'sm'
}

function clampItem(item: LayoutItem, cols: number, rows: number): LayoutItem {
  const w = Math.min(Math.max(1, item.w), cols)
  const h = Math.min(Math.max(1, item.h), rows)
  return {
    ...item,
    w,
    h,
    x: Math.min(Math.max(0, item.x), cols - w),
    y: Math.min(Math.max(0, item.y), rows - h),
    // A minimum larger than the item itself would let minMaxSize push it back out.
    ...(item.minW === undefined ? {} : { minW: Math.min(item.minW, w) }),
    ...(item.minH === undefined ? {} : { minH: Math.min(item.minH, h) }),
  }
}

/** True when any two items share a grid cell. */
export function hasOverlap(items: LayoutItem[]): boolean {
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const first = items[a]
      const second = items[b]
      const apart =
        first.x + first.w <= second.x ||
        second.x + second.w <= first.x ||
        first.y + first.h <= second.y ||
        second.y + second.h <= first.y
      if (!apart) return true
    }
  }
  return false
}

/**
 * Dense first-fit fallback: places every item in reading order (top to bottom, then left
 * to right) at the first free cell, preferring its own column. Only reached when the
 * layout is actually broken (see normalizeLayout) - on a clean layout this reproduces
 * dense, gap-free positions, which is exactly what must NOT happen to a layout a musician
 * left gaps in on purpose.
 */
function pack(layout: LayoutItem[], cols: number, rows: number): LayoutItem[] {
  const occupied: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false))

  function isFree(x: number, y: number, w: number, h: number): boolean {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        if (occupied[row][col]) return false
      }
    }
    return true
  }

  function occupy(x: number, y: number, w: number, h: number): void {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        occupied[row][col] = true
      }
    }
  }

  const placed = new Map<string, LayoutItem>()
  const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)

  for (const item of ordered) {
    const wanted = { w: item.w, h: item.h }
    let w = wanted.w
    let h = wanted.h
    let spot: { x: number; y: number } | null = null

    // Try the requested size first, then progressively smaller ones. Shrinking beats
    // overlapping: a smaller widget is still usable, one buried under another is not.
    outer: for (h = wanted.h; h >= 1; h--) {
      for (w = wanted.w; w >= 1; w--) {
        const preferredX = Math.min(Math.max(0, item.x), cols - w)
        for (let y = 0; y + h <= rows; y++) {
          if (isFree(preferredX, y, w, h)) {
            spot = { x: preferredX, y }
            break outer
          }
          for (let x = 0; x + w <= cols; x++) {
            if (isFree(x, y, w, h)) {
              spot = { x, y }
              break outer
            }
          }
        }
      }
    }

    // Not a single free cell left. Park it in the last row rather than lose a widget
    // silently - an overlapping widget can still be moved, a missing one cannot.
    const position = spot ?? { x: 0, y: rows - 1 }
    if (spot === null) {
      w = wanted.w
      h = 1
    }

    occupy(position.x, position.y, w, h)
    placed.set(item.i, {
      ...item,
      x: position.x,
      y: position.y,
      w,
      h,
      ...(item.minW === undefined ? {} : { minW: Math.min(item.minW, w) }),
      ...(item.minH === undefined ? {} : { minH: Math.min(item.minH, h) }),
    })
  }

  return layout.map((item) => placed.get(item.i) ?? item)
}

/**
 * Repairs a stored layout just enough to be safe to render: every item inside the grid,
 * and free of overlaps. Nothing more.
 *
 * It used to always dense-pack from scratch, on every read - react-grid-layout's own
 * `layout` prop is recomputed from this on every render, so that silently closed any
 * vertical gap a musician had deliberately left between two widgets the instant the page
 * next re-rendered. Now it only touches a layout that is actually broken: out of bounds
 * (legacy data, or a screen smaller than the one it was arranged on) or genuinely
 * overlapping. A layout that is already valid - gaps included - comes back byte-for-byte
 * unchanged, because it has nothing to repair.
 */
export function normalizeLayout(
  layout: LayoutItem[],
  cols = GRID_COLUMNS,
  rows = GRID_ROWS,
): LayoutItem[] {
  const clamped = layout.map((item) => clampItem(item, cols, rows))
  if (!hasOverlap(clamped)) return clamped
  return pack(clamped, cols, rows)
}

/**
 * Places a new widget at the bottom of every breakpoint's layout. Appending rather than
 * inserting means nothing the musician already positioned moves out from under them.
 */
export function withWidgetAppended(
  dashboard: Dashboard,
  type: string,
  size: WidgetSize,
  instanceId: string,
): Dashboard {
  const layouts = Object.fromEntries(
    BREAKPOINTS.map((breakpoint) => {
      const items = dashboard.layouts[breakpoint] ?? []
      const bottom = items.reduce((max, item) => Math.max(max, item.y + item.h), 0)
      // Shrink rather than overflow: a new widget that would not fit below the existing
      // ones takes whatever height is left, down to the last row.
      const h = Math.min(size.h, Math.max(1, GRID_ROWS - bottom))
      const placed: LayoutItem = { ...size, h, i: instanceId, x: 0, y: Math.min(bottom, GRID_ROWS - h) }
      return [breakpoint, normalizeLayout([...items, placed])]
    }),
  )

  return { ...dashboard, widgets: [...dashboard.widgets, { i: instanceId, type }], layouts }
}

/** Removes a widget instance from the widget list and from every breakpoint's layout. */
export function withWidgetRemoved(dashboard: Dashboard, instanceId: string): Dashboard {
  return {
    ...dashboard,
    widgets: dashboard.widgets.filter((widget) => widget.i !== instanceId),
    layouts: Object.fromEntries(
      Object.entries(dashboard.layouts).map(([breakpoint, items]) => [
        breakpoint,
        items.filter((item) => item.i !== instanceId),
      ]),
    ),
  }
}

/**
 * The widget library from docs/07 section 4: a widget whose plugin the band does not have
 * is not offered at all - that is what keeps simple setups uncluttered. Merely unreachable
 * hardware still shows up, because those widgets are allowed to sit in a layout greyed out.
 */
export function availableWidgets<T extends { requires: CapabilityId[] }>(
  definitions: T[],
  capabilities: Map<CapabilityId, CapabilityStatus>,
): T[] {
  return definitions.filter(
    (definition) => capabilityStatusFor(definition.requires, capabilities) !== 'missing',
  )
}
