import { BREAKPOINTS, type Breakpoint, type Dashboard, type DashboardMode, type LayoutItem } from 'shared-types'
import type { CapabilityId, Profile, StageRole } from 'shared-types'
import { capabilityStatusFor, type CapabilityStatus } from './capabilities'
import { fmtItems, gridLog } from './gridDebug'
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
  // maxW/maxH are enforced here too (#22), not just handed to react-grid-layout as a resize
  // hint - a dashboard stored before a widget had a max (or with one from an older, larger
  // registry value) must come back within bounds on its own, same "clamped on read" reasoning
  // minW/minH already followed below.
  const w = Math.min(Math.max(1, item.w), cols, item.maxW ?? cols)
  const h = Math.min(Math.max(1, item.h), rows, item.maxH ?? rows)
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

function createOccupancyGrid(cols: number, rows: number) {
  const occupied: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false))

  return {
    isFree(x: number, y: number, w: number, h: number): boolean {
      for (let row = y; row < y + h; row++) {
        for (let col = x; col < x + w; col++) {
          if (occupied[row][col]) return false
        }
      }
      return true
    },
    occupy(x: number, y: number, w: number, h: number): void {
      for (let row = y; row < y + h; row++) {
        for (let col = x; col < x + w; col++) {
          occupied[row][col] = true
        }
      }
    },
  }
}

/**
 * Places one item at the first free cell (top to bottom, then left to right), preferring
 * its own column, trying progressively smaller sizes before giving up. Shrinking beats
 * overlapping: a smaller widget is still usable, one buried under another is not. Shared by
 * pack() (an empty grid - every item competes for space) and resolveInteraction() (a grid
 * pre-occupied by every item that does NOT need to move - only the genuinely blocked ones
 * are placed into whatever gaps that leaves).
 */
function placeInGrid(
  grid: ReturnType<typeof createOccupancyGrid>,
  item: LayoutItem,
  cols: number,
  rows: number,
): LayoutItem {
  let w = item.w
  let h = item.h
  let spot: { x: number; y: number } | null = null

  outer: for (h = item.h; h >= 1; h--) {
    for (w = item.w; w >= 1; w--) {
      const preferredX = Math.min(Math.max(0, item.x), cols - w)
      for (let y = 0; y + h <= rows; y++) {
        if (grid.isFree(preferredX, y, w, h)) {
          spot = { x: preferredX, y }
          break outer
        }
        for (let x = 0; x + w <= cols; x++) {
          if (grid.isFree(x, y, w, h)) {
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
    w = item.w
    h = 1
  }

  grid.occupy(position.x, position.y, w, h)
  return {
    ...item,
    x: position.x,
    y: position.y,
    w,
    h,
    ...(item.minW === undefined ? {} : { minW: Math.min(item.minW, w) }),
    ...(item.minH === undefined ? {} : { minH: Math.min(item.minH, h) }),
  }
}

/**
 * Dense first-fit fallback: places every item in reading order. Only reached when the
 * layout is actually broken (see normalizeLayout) - on a clean layout this reproduces
 * dense, gap-free positions, which is exactly what must NOT happen to a layout a musician
 * left gaps in on purpose.
 */
function pack(layout: LayoutItem[], cols: number, rows: number): LayoutItem[] {
  const grid = createOccupancyGrid(cols, rows)
  const placed = new Map<string, LayoutItem>()
  const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)

  for (const item of ordered) {
    placed.set(item.i, placeInGrid(grid, item, cols, rows))
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
  const packed = pack(clamped, cols, rows)
  gridLog('normalizeLayout: repacked an overlapping/out-of-bounds layout', {
    before: fmtItems(layout),
    after: fmtItems(packed),
  })
  return packed
}

/** True when two items share a grid cell - the pairwise version hasOverlap checks all pairs for. */
function collides(a: LayoutItem, b: LayoutItem): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
}

/**
 * Undoes react-grid-layout's own collision-avoidance shuffling once a drag or resize ends.
 * While the active item is being dragged across the grid, the library pushes any widget it
 * passes over out of the way - but it never moves them back once the active item has moved
 * on, so sliding one widget past another permanently shoves that other widget aside (and,
 * left unchecked, clean off the visible grid). This restores every item but the active one
 * to its pre-interaction position, and only re-places the ones that genuinely still overlap
 * the active item's final spot - not the whole layout, so nothing else drifts either.
 *
 * `previous` is that same frame-by-frame placement, fed back in by the caller (null outside
 * an interaction, or on its first frame). A blocked item that still fits where the last
 * frame put it keeps that spot instead of calling placeInGrid again from scratch - without
 * this, a widget with almost no slack around it (e.g. one nearly as large as the whole grid)
 * gets a different shrink/position solution on every single frame as the active item passes
 * over it by a single cell, which reads as that widget frantically resizing many times a
 * second for the length of the drag.
 */
export function resolveInteraction(
  baseline: LayoutItem[],
  activeId: string,
  current: LayoutItem[],
  previous: LayoutItem[] | null = null,
  cols = GRID_COLUMNS,
  rows = GRID_ROWS,
): LayoutItem[] {
  const activeItem = current.find((item) => item.i === activeId)
  if (!activeItem) {
    gridLog(`resolveInteraction: active item ${activeId} not found in current layout`, {
      current: fmtItems(current),
    })
    return current
  }

  const baselineById = new Map(baseline.map((item) => [item.i, item]))
  const restored = current.map((item) =>
    item.i === activeId ? item : (baselineById.get(item.i) ?? item),
  )

  const blocked = restored.filter((item) => item.i !== activeId && collides(item, activeItem))
  if (blocked.length === 0) {
    gridLog(`resolveInteraction active=${activeId}@[${activeItem.x},${activeItem.y} ${activeItem.w}x${activeItem.h}] no collisions`)
    return restored
  }

  gridLog(
    `resolveInteraction active=${activeId}@[${activeItem.x},${activeItem.y} ${activeItem.w}x${activeItem.h}] blocked=${blocked.map((item) => item.i).join(',')}`,
  )
  gridLog('  restored (pre-placement):', fmtItems(restored))

  const grid = createOccupancyGrid(cols, rows)
  const blockedIds = new Set(blocked.map((item) => item.i))
  for (const item of restored) {
    if (!blockedIds.has(item.i)) grid.occupy(item.x, item.y, item.w, item.h)
  }

  const previousById = new Map((previous ?? []).map((item) => [item.i, item]))
  const placed = new Map<string, LayoutItem>()
  for (const item of [...blocked].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const sticky = previousById.get(item.i)
    const keepSticky =
      sticky !== undefined && !collides(sticky, activeItem) && grid.isFree(sticky.x, sticky.y, sticky.w, sticky.h)
    const placement = keepSticky ? sticky : placeInGrid(grid, item, cols, rows)
    placed.set(item.i, placement)
    grid.occupy(placement.x, placement.y, placement.w, placement.h)
  }
  const result = restored.map((item) => placed.get(item.i) ?? item)
  gridLog('  result:', fmtItems(result))
  return result
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
      const items = normalizeLayout(dashboard.layouts[breakpoint] ?? [])
      // Below the existing widgets at full size when it fits there (a deliberate gap between
      // widgets stays untouched), else the first free spot of full size anywhere, and only
      // when neither exists shrunk into what is left. It used to always go below and shrink
      // to the remaining rows (down to one) - how a widget added in portrait became a 25px
      // strip in the landscape layout (GUI audit, 2026-09-26); displayLayout() now also shows
      // a derived layout instead of such a squeezed one.
      const bottom = items.reduce((max, item) => Math.max(max, item.y + item.h), 0)
      const fullWidth = Math.min(size.w, GRID_COLUMNS)
      let placed: LayoutItem
      if (bottom + size.h <= GRID_ROWS) {
        placed = { ...size, w: fullWidth, i: instanceId, x: 0, y: bottom }
      } else {
        const grid = createOccupancyGrid(GRID_COLUMNS, GRID_ROWS)
        for (const item of items) grid.occupy(item.x, item.y, item.w, item.h)
        placed = placeInGrid(grid, { ...size, w: fullWidth, i: instanceId, x: 0, y: 0 }, GRID_COLUMNS, GRID_ROWS)
      }
      return [breakpoint, normalizeLayout([...items, placed])]
    }),
  )

  return {
    ...dashboard,
    widgets: [...dashboard.widgets, { i: instanceId, type, frameless: false }],
    layouts,
  }
}

/**
 * Whether `size` fits somewhere in `items`' grid at full size - what withWidgetAppended places
 * without shrinking. False means adding the widget squeezes it into what is left, which the
 * widget library warns about instead of doing silently (GUI audit 2026-09-26: 22 widgets on one
 * dashboard ended up 45px tall, with no hint).
 */
export function hasRoomFor(items: LayoutItem[], size: { w: number; h: number }): boolean {
  const normalized = normalizeLayout(items)
  const w = Math.min(size.w, GRID_COLUMNS)
  const h = Math.min(size.h, GRID_ROWS)
  const grid = createOccupancyGrid(GRID_COLUMNS, GRID_ROWS)
  for (const item of normalized) grid.occupy(item.x, item.y, item.w, item.h)
  for (let y = 0; y + h <= GRID_ROWS; y++) {
    for (let x = 0; x + w <= GRID_COLUMNS; x++) {
      if (grid.isFree(x, y, w, h)) return true
    }
  }
  return false
}

/** A widget's minimum and default size in grid cells (from the widget registry). */
export interface MinSize {
  minW?: number
  minH?: number
  /** Default size - what a collapsed widget is re-placed at when there is room. */
  w?: number
  h?: number
}

/** Items smaller than their widget's current minimum in either direction - outlined in edit
 * mode, so a widget that cannot show its content is visible while arranging, not only later on
 * stage. Broader than squeezedItems: a deliberately small widget counts here too. */
export function belowMinimumItems(items: LayoutItem[], minFor: (instanceId: string) => MinSize | undefined): LayoutItem[] {
  return items.filter((item) => {
    const min = minFor(item.i)
    return !!min && ((min.minW !== undefined && item.w < min.minW) || (min.minH !== undefined && item.h < min.minH))
  })
}

/** Items collapsed to at most half their widget's minimum size - what a full grid does to a
 * widget it has to squeeze in (see withWidgetAppended: one row, 25px in landscape). A widget
 * just below a minimum that was raised since it was placed, or one deliberately made small, is
 * the user's arrangement and does not count. */
export function squeezedItems(items: LayoutItem[], minFor: (instanceId: string) => MinSize | undefined): LayoutItem[] {
  return items.filter((item) => {
    const min = minFor(item.i)
    return (
      !!min &&
      ((min.minH !== undefined && min.minH > 1 && item.h <= min.minH / 2) ||
        (min.minW !== undefined && min.minW > 1 && item.w <= min.minW / 2))
    )
  })
}

/** Nominal canvas per breakpoint, CSS px - only used to convert a layout between breakpoints by
 * pixel size (a landscape tablet column is ~1.6x wider, its rows ~0.6x as tall as in portrait). */
export const BREAKPOINT_CANVAS: Record<Breakpoint, { w: number; h: number }> = {
  sm: { w: 400, h: 760 },
  md: { w: 800, h: 1220 },
  lg: { w: 1280, h: 740 },
  xl: { w: 1920, h: 1040 },
}

/**
 * The layout for `to`, derived from an arranged `source` layout of breakpoint `from`: every
 * widget keeps roughly its pixel size (columns and rows converted by the breakpoints' canvas),
 * in the source's reading order, packed into the 12 x 24 grid. If that doesn't fit, heights
 * are scaled down step by step - never below the widget's minimum - until nothing is squeezed.
 * A starting point for a breakpoint nobody arranged, not a finished design.
 */
export function deriveLayout(
  source: LayoutItem[],
  from: Breakpoint,
  to: Breakpoint,
  minFor: (instanceId: string) => MinSize | undefined,
): LayoutItem[] {
  const colRatio = BREAKPOINT_CANVAS[from].w / BREAKPOINT_CANVAS[to].w
  const rowRatio = BREAKPOINT_CANVAS[from].h / BREAKPOINT_CANVAS[to].h
  const ordered = [...source].sort((a, b) => a.y - b.y || a.x - b.x)
  let placed: LayoutItem[] = []
  for (let scale = 1; scale >= 0.3; scale -= 0.1) {
    const grid = createOccupancyGrid(GRID_COLUMNS, GRID_ROWS)
    placed = ordered.map((item) => {
      const min = minFor(item.i)
      const w = Math.min(GRID_COLUMNS, Math.max(min?.minW ?? 1, Math.round(item.w * colRatio)))
      const h = Math.min(GRID_ROWS, Math.max(min?.minH ?? 1, Math.round(item.h * rowRatio * scale)))
      const x = Math.min(Math.round(item.x * colRatio), GRID_COLUMNS - w)
      return placeInGrid(grid, { ...item, x, y: 0, w, h }, GRID_COLUMNS, GRID_ROWS)
    })
    if (squeezedItems(placed, minFor).length === 0) break
  }
  return placed
}

/** Which arranged breakpoint to derive from, nearest first. */
const DERIVE_FROM: Record<Breakpoint, Breakpoint[]> = {
  sm: ['md', 'lg', 'xl'],
  md: ['lg', 'sm', 'xl'],
  lg: ['md', 'xl', 'sm'],
  xl: ['lg', 'md', 'sm'],
}

/**
 * The stored layout with only its collapsed widgets moved into free space, at their default
 * size where it fits (at least their minimum) - everything the user arranged stays where it is.
 */
export function repairLayout(stored: LayoutItem[], minFor: (instanceId: string) => MinSize | undefined): LayoutItem[] {
  const collapsed = new Set(squeezedItems(stored, minFor).map((item) => item.i))
  const grid = createOccupancyGrid(GRID_COLUMNS, GRID_ROWS)
  for (const item of stored) if (!collapsed.has(item.i)) grid.occupy(item.x, item.y, item.w, item.h)
  const moved = new Map<string, LayoutItem>()
  for (const item of stored) {
    if (!collapsed.has(item.i)) continue
    const size = minFor(item.i) ?? {}
    const w = Math.min(GRID_COLUMNS, Math.max(size.minW ?? 1, size.w ?? item.w))
    const h = Math.min(GRID_ROWS, Math.max(size.minH ?? 1, size.h ?? item.h))
    moved.set(item.i, placeInGrid(grid, { ...item, y: 0, w, h }, GRID_COLUMNS, GRID_ROWS))
  }
  return stored.map((item) => moved.get(item.i) ?? item)
}

export interface DisplayLayout {
  items: LayoutItem[]
  /** `stored` as saved, `repaired` = only the collapsed widgets re-placed, `derived` = the
   * whole layout derived from `derivedFrom`. */
  source: 'stored' | 'repaired' | 'derived'
  /** The breakpoint the items were derived from (source `derived`), else null. */
  derivedFrom: Breakpoint | null
  /** Widgets squeezed below their minimum in the *stored* layout of this breakpoint. */
  squeezed: number
}

/**
 * What to show for `breakpoint`: the stored layout, unless it squeezes widgets below their
 * minimum (a breakpoint nobody arranged - e.g. a portrait dashboard seen in landscape, GUI audit
 * 2026-09-26: four widgets 25px tall) and another breakpoint is fully arranged; then a layout
 * derived from that one. Pure and not persisted - Dashboard.tsx only saves what the user drags,
 * so a derived layout never overwrites anything until "übernehmen" in edit mode.
 */
export function displayLayout(
  layouts: Partial<Record<Breakpoint, LayoutItem[]>>,
  breakpoint: Breakpoint,
  minFor: (instanceId: string) => MinSize | undefined,
): DisplayLayout {
  const stored = normalizeLayout(layouts[breakpoint] ?? [])
  const squeezed = squeezedItems(stored, minFor).length
  if (squeezed === 0) return { items: stored, source: 'stored', derivedFrom: null, squeezed }
  // Least invasive first: keep the arrangement, only re-place what collapsed.
  const repaired = repairLayout(stored, minFor)
  if (squeezedItems(repaired, minFor).length === 0) return { items: repaired, source: 'repaired', derivedFrom: null, squeezed }
  // The best-arranged other breakpoint: fewest collapsed widgets (nearest wins a tie), and it
  // has to be better than what is stored here.
  const ids = new Set(stored.map((item) => item.i))
  let best: { breakpoint: Breakpoint; source: LayoutItem[]; squeezed: number } | null = null
  for (const candidate of DERIVE_FROM[breakpoint]) {
    const source = normalizeLayout(layouts[candidate] ?? [])
    const coversAll = source.length > 0 && [...ids].every((id) => source.some((item) => item.i === id))
    if (!coversAll) continue
    const candidateSqueezed = squeezedItems(source, minFor).length
    if (candidateSqueezed < squeezed && (!best || candidateSqueezed < best.squeezed)) {
      best = { breakpoint: candidate, source, squeezed: candidateSqueezed }
    }
  }
  if (!best) return { items: stored, source: 'stored', derivedFrom: null, squeezed }
  return { items: deriveLayout(best.source, best.breakpoint, breakpoint, minFor), source: 'derived', derivedFrom: best.breakpoint, squeezed }
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
 * Whether a dashboard should be listed/selectable for the given (possibly absent) active
 * profile. Public dashboards are visible to everyone, always - including when no profile
 * is active, which is what keeps a fresh device usable before anyone's picked who they
 * are. A private one is visible only to its owner: either the matching profile, or (for a
 * role-level Station meant for whoever fills that role that night) a profile holding that
 * stage role (#57 - `ownerRole` matches against `Profile.stageRoles`, the closed multi-value
 * field, not the free-text `role`). A dashboard's `ownerRole` that no longer matches any known
 * StageRole (e.g. a legacy value from before #57) just matches nobody rather than throwing -
 * `stageRoles.includes` is a plain runtime check, not a parse. This is a client-side filter
 * only, not real access control - see the Dashboard.visibility doc comment in shared-types.
 */
export function isDashboardVisible(dashboard: Dashboard, activeProfile: Profile | undefined): boolean {
  if (dashboard.visibility !== 'private') return true
  if (!activeProfile) return false
  if (dashboard.ownerProfileId) return dashboard.ownerProfileId === activeProfile.id
  if (dashboard.ownerRole) return activeProfile.stageRoles.includes(dashboard.ownerRole as StageRole)
  return true
}

/** Whether a dashboard is offered in the given session mode - unset `modes` means both. */
export function isDashboardAvailableInMode(dashboard: Dashboard, mode: DashboardMode): boolean {
  return !dashboard.modes || dashboard.modes.includes(mode)
}

/**
 * The dashboards this device may pick from right now: visible to the active profile (private
 * Stations) and offered in the current session mode. Falls back to every visible dashboard when
 * the mode filter would leave none (e.g. the only Gig dashboard is someone else's private
 * Station) - a stage tablet must never end up with an empty screen over a menu setting.
 */
export function dashboardsForMode(dashboards: Dashboard[], activeProfile: Profile | undefined, mode: DashboardMode): Dashboard[] {
  const visible = dashboards.filter((dashboard) => isDashboardVisible(dashboard, activeProfile))
  const inMode = visible.filter((dashboard) => isDashboardAvailableInMode(dashboard, mode))
  return inMode.length > 0 ? inMode : visible
}

/**
 * Which of `candidates` (already filtered by dashboardsForMode) this device shows: the one it
 * last used in this mode, else the one it showed last in any mode if that is also offered here
 * (switching modes on a dashboard available in both keeps it), else the first. So Gig -> the
 * gig dashboard and Solo Üben -> the rehearsal dashboard, automatically.
 */
export function resolveActiveDashboard(
  candidates: Dashboard[],
  rememberedForMode: string | undefined,
  lastShown: string | undefined,
): Dashboard | undefined {
  return (
    candidates.find((dashboard) => dashboard.id === rememberedForMode) ??
    candidates.find((dashboard) => dashboard.id === lastShown) ??
    candidates[0]
  )
}

/** Whether `mode` may be switched off for `dashboard`: only if another dashboard is still offered
 * in that mode - so no mode is ever left without a dashboard. */
export function canRemoveMode(dashboards: Dashboard[], dashboard: Dashboard, mode: DashboardMode): boolean {
  return dashboards.some((other) => other.id !== dashboard.id && isDashboardAvailableInMode(other, mode))
}

/** The dashboard's `modes` after toggling one - `undefined` again once both are on, so a
 * dashboard offered everywhere stays indistinguishable from one written before the field. */
export function toggleDashboardMode(dashboard: Dashboard, mode: DashboardMode): DashboardMode[] | undefined {
  const current: DashboardMode[] = dashboard.modes ?? ['gig', 'practice']
  const next = current.includes(mode) ? current.filter((m) => m !== mode) : [...current, mode]
  if (next.length === 0) return current
  return next.length === 2 ? undefined : next
}

/**
 * The widget library from docs/07 section 4: a widget whose plugin the band does not have
 * is not offered at all - that is what keeps simple setups uncluttered. Merely unreachable
 * hardware still shows up, because those widgets are allowed to sit in a layout greyed out.
 *
 * `activeRoles` is a second, independent filter on top (#57): a widget with `relevantRoles`
 * set is only offered to a profile holding at least one of those stage roles - unset
 * `relevantRoles` (most widgets today) or no active roles (nobody signed in, or signed in with
 * none assigned) means "relevant to everyone," so this is a no-op until widgets actually start
 * declaring roles.
 */
export function availableWidgets<T extends { requires: CapabilityId[]; relevantRoles?: StageRole[] }>(
  definitions: T[],
  capabilities: Map<CapabilityId, CapabilityStatus>,
  activeRoles?: StageRole[],
): T[] {
  return definitions.filter((definition) => {
    if (capabilityStatusFor(definition.requires, capabilities) === 'missing') return false
    if (definition.relevantRoles && !definition.relevantRoles.some((role) => activeRoles?.includes(role))) return false
    return true
  })
}
