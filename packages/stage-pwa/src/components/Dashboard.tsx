import { useEffect, useMemo, useRef } from 'react'
import {
  ResponsiveGridLayout,
  type Compactor,
  type Layout,
  type LayoutItem as RglLayoutItem,
} from 'react-grid-layout'
import type { Breakpoint, Dashboard as DashboardDoc, LayoutItem } from 'shared-types'
import { capabilityStatusFor } from '../lib/capabilities'
import {
  breakpointFor,
  GRID_COLUMNS,
  GRID_ROWS,
  gridMetrics,
  normalizeLayout,
  resolveInteraction,
  withWidgetRemoved,
} from '../lib/dashboardLayout'
import { fmtItems, gridLog } from '../lib/gridDebug'
import { useCapabilities } from '../lib/useCapabilities'
import { useElementSize } from '../lib/useElementSize'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useEditModeStore } from '../store/useEditModeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { WIDGET_REGISTRY } from '../widgets/registry'
import { DashboardEditBar } from './DashboardEditBar'
import { WidgetFrame } from './WidgetFrame'

/** docs/07 section 3: phone, tablet portrait, tablet landscape, stage monitor. */
const BREAKPOINT_WIDTHS: Record<Breakpoint, number> = { xl: 1600, lg: 1024, md: 640, sm: 0 }
const COLS: Record<Breakpoint, number> = {
  xl: GRID_COLUMNS,
  lg: GRID_COLUMNS,
  md: GRID_COLUMNS,
  sm: GRID_COLUMNS,
}

function layoutFor(dashboard: DashboardDoc, breakpoint: Breakpoint): LayoutItem[] {
  // Clamped on read, not only on write: a dashboard stored before the grid had bounds
  // must become usable again immediately, without the user first having to fix it.
  return normalizeLayout(dashboard.layouts[breakpoint] ?? [])
}

// Only our own LayoutItem fields, not react-grid-layout's interaction bookkeeping (moved,
// static, ...) - that's meaningless once persisted and just noise the next read carries.
function toItems(layout: Layout): LayoutItem[] {
  return layout.map(({ i, x, y, w, h, minW, minH }) => ({
    i,
    x,
    y,
    w,
    h,
    ...(minW === undefined ? {} : { minW }),
    ...(minH === undefined ? {} : { minH }),
  }))
}

export function Dashboard() {
  const dashboards = useDashboardsStore((state) => state.dashboards)
  const loaded = useDashboardsStore((state) => state.loaded)
  const resetNonce = useDashboardsStore((state) => state.resetNonce)
  const setLayout = useDashboardsStore((state) => state.setLayout)
  const save = useDashboardsStore((state) => state.save)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const byWorkspace = useActiveDashboardStore((state) => state.byWorkspace)
  const isEditing = useEditModeStore((state) => state.isEditing)
  const capabilities = useCapabilities()
  const [containerRef, { width, height }] = useElementSize()
  // Real measurement or nothing: react-grid-layout's own bundled width hook starts every
  // mount with a hard-coded 1280px guess and only corrects a frame later, which on a real
  // device (rarely 1280px wide) put every widget at whatever position that guess implied
  // until the correction landed - "off-screen right after load, fixed by anything that
  // remounts the grid". useElementSize has no guess to fall back on: width starts at 0,
  // and the grid below waits for a real one.
  const mounted = width > 0 && height > 0
  // Derived, not stored: onBreakpointChange only fires on a change, which would leave a
  // portrait tablet writing its edits into the landscape layout.
  const breakpoint = breakpointFor(width)
  const metrics = gridMetrics(height)
  // The layout as it stood right before the current drag/resize, plus which widget that
  // interaction belongs to - resolveInteraction needs both to tell "genuinely still in the
  // way" apart from "just passed over a moment ago", live as the interaction happens. null
  // outside of an active interaction, so the rubber-band effect below is a no-op then.
  const interactionBaseline = useRef<{ layout: LayoutItem[]; activeId: string } | null>(null)
  // The previous frame's resolveInteraction output, fed back in as the next frame's
  // hysteresis anchor (see resolveInteraction's own doc comment) - reset whenever a fresh
  // interaction begins so nothing sticks across separate gestures.
  const previousResolved = useRef<LayoutItem[] | null>(null)
  const captureBaseline = (layout: Layout, item: RglLayoutItem | null) => {
    if (item) {
      interactionBaseline.current = { layout: toItems(layout), activeId: item.i }
      previousResolved.current = null
      gridLog(`interaction start active=${item.i}`, fmtItems(toItems(layout)))
    }
  }
  // Persisting from onDragStop/onResizeStop themselves, not from the grid's general
  // onLayoutChange - that fires for ANY layout-prop change, including ones this component
  // caused itself (e.g. Zurücksetzen rewriting the active dashboard while still in edit
  // mode). Writing those back too created a loop: our own write became a CouchDB change,
  // which updated the layouts prop, which the grid dutifully "changed" again, which got
  // written back again - editing had to stop or the dashboard had to switch to break it.
  // onDragStop/onResizeStop only fire once, at the true end of an actual gesture.
  const stopInteraction = (layout: Layout) => {
    gridLog('interaction stop, persisting', fmtItems(toItems(layout)))
    interactionBaseline.current = null
    previousResolved.current = null
    if (active) void setLayout(active.id, breakpoint, toItems(layout))
  }
  // react-grid-layout pushes other widgets out of the active one's way as it passes over
  // them, then calls compact() on every single drag/resize frame to settle the result -
  // normally that also closes any deliberate gap the moment a drag starts, which is why
  // Dashboard used noCompactor before. This compactor instead behaves like noCompactor
  // (identity) whenever there is no active interaction, and while one is running, restores
  // every widget but the active one to its pre-interaction spot - live, not just once the
  // drag ends - so a displaced widget snaps back the moment it's no longer in the way,
  // like it's on a rubber band anchored to where it started.
  const compactor = useMemo<Compactor>(
    () => ({
      // Not null: react-grid-layout's own onDrag/onResize call its built-in moveElement
      // BEFORE compact() below ever runs, and type: null specifically opts moveElement's
      // collision handling into a "swap" - it silently relocates the ACTIVE item itself
      // (not just the widget it collided with) based on whatever the *previous* frame's
      // compact() output looked like. Since that output is our own rubber-band result,
      // this closed a feedback loop: our compaction fed react-grid-layout's own collision
      // engine, which fed back a different active-item position next frame, which changed
      // what our compaction saw next - visible as the dragged widget's row flickering
      // between two values many times a second near a large neighbor. 'wrap' is the one
      // other CompactType react-grid-layout ships that hits none of moveElement's
      // vertical/horizontal/null branches, so that pre-pass becomes a no-op and collision
      // resolution is entirely ours, as intended.
      type: 'wrap',
      allowOverlap: false,
      compact(layout) {
        const baseline = interactionBaseline.current
        if (!baseline) return [...layout]
        const resolvedItems = resolveInteraction(
          baseline.layout,
          baseline.activeId,
          toItems(layout),
          previousResolved.current,
        )
        previousResolved.current = resolvedItems
        const resolved = new Map(resolvedItems.map((item) => [item.i, item]))
        return layout.map((item) => {
          const r = resolved.get(item.i)
          return r ? { ...item, x: r.x, y: r.y, w: r.w, h: r.h } : item
        })
      },
    }),
    [],
  )

  // A dashboard the device remembers may have been deleted on another tablet.
  const active =
    dashboards.find((dashboard) => dashboard.id === byWorkspace[workspaceId]) ?? dashboards[0]

  // A baseline belongs to one specific dashboard's widgets and must never outlive it - e.g.
  // switching away mid-drag, or the active dashboard being rewritten out from under the grid
  // (Zurücksetzen re-creates it with the same default widget ids), would otherwise leave a
  // stale baseline that the compactor below keeps trying to enforce against data it no
  // longer describes.
  useEffect(() => {
    interactionBaseline.current = null
    previousResolved.current = null
  }, [active?.id])

  const layouts = useMemo(() => {
    if (!active) return {}
    return Object.fromEntries(
      (Object.keys(BREAKPOINT_WIDTHS) as Breakpoint[]).map((name) => [
        name,
        layoutFor(active, name),
      ]),
    )
  }, [active])

  if (!loaded) {
    return <div className="flex h-full items-center justify-center text-ink-faint">Lade …</div>
  }
  if (!active) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        Kein Dashboard vorhanden
      </div>
    )
  }

  function removeWidget(instanceId: string) {
    if (!active) return
    void save(withWidgetRemoved(active, instanceId))
  }

  function updateConfig(instanceId: string, config: Record<string, unknown>) {
    if (!active) return
    void save({
      ...active,
      widgets: active.widgets.map((widget) =>
        widget.i === instanceId ? { ...widget, config } : widget,
      ),
    })
  }

  return (
    <div className="flex h-dvh flex-col sb-app-bg">
      {isEditing && <DashboardEditBar dashboard={active} capabilities={capabilities} />}

      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden">
        {mounted && (
          <ResponsiveGridLayout
            // A fresh instance per dashboard (and per reset of the active one, via
            // resetNonce), not one instance reconciled in place: react-grid-layout keeps
            // its own internal copy of the layout and resyncs it from props via a
            // useEffect whose dependencies include that same internal copy. Switching
            // dashboards, or Zurücksetzen rewriting the active one, can otherwise land it
            // resyncing against its own now-stale internal state instead of the fresh
            // props for a render or two - which regenerates a slightly different (and
            // still wrong) layout every time, forever, entirely inside the library.
            // Remounting sidesteps that class of bug outright: the initial state a fresh
            // instance computes always comes straight from the current, consistent props.
            key={`${active.id}:${resetNonce}`}
            width={width}
            layouts={layouts}
            breakpoints={BREAKPOINT_WIDTHS}
            cols={COLS}
            rowHeight={metrics.rowHeight}
            maxRows={GRID_ROWS}
            margin={[metrics.margin, metrics.margin]}
            containerPadding={[metrics.padding, metrics.padding]}
            compactor={compactor}
            // Read-only during the show (docs/07): nothing moves unless the Edit-Lock is
            // open. The handle is the whole widget body (WidgetFrame's root), not a thin
            // strip of it - `cancel` excludes the per-widget action menu, which sits inside
            // that same element, so tapping a button there doesn't also start a drag.
            dragConfig={{ enabled: isEditing, handle: '.widget-drag-handle', cancel: '.widget-menu' }}
            // All eight handles, not just the bottom-right corner: a widget pinned to the
            // bottom or right edge of the grid otherwise has nowhere reachable to grab.
            resizeConfig={{
              enabled: isEditing,
              handles: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'],
            }}
            onDragStart={captureBaseline}
            onResizeStart={captureBaseline}
            onDragStop={stopInteraction}
            onResizeStop={stopInteraction}
          >
            {active.widgets.map((widget) => {
              const definition = WIDGET_REGISTRY[widget.type]
              if (!definition) return <div key={widget.i} />
              const status = capabilityStatusFor(definition.requires, capabilities)
              const { Component, ConfigPanel } = definition

              return (
                <div key={widget.i}>
                  <WidgetFrame
                    title={definition.title}
                    status={status}
                    isEditing={isEditing}
                    onRemove={() => removeWidget(widget.i)}
                    configPanel={
                      ConfigPanel && (
                        <ConfigPanel
                          config={widget.config}
                          onChange={(next) => updateConfig(widget.i, next)}
                        />
                      )
                    }
                  >
                    <Component config={widget.config} />
                  </WidgetFrame>
                </div>
              )
            })}
          </ResponsiveGridLayout>
        )}
      </div>
    </div>
  )
}
