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
  const pendingLayout = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The layout as it stood right before the current drag/resize, plus which widget that
  // interaction belongs to - resolveInteraction needs both to tell "genuinely still in the
  // way" apart from "just passed over a moment ago", live as the interaction happens. null
  // outside of an active interaction, so the rubber-band effect below is a no-op then.
  const interactionBaseline = useRef<{ layout: LayoutItem[]; activeId: string } | null>(null)
  const captureBaseline = (layout: Layout, item: RglLayoutItem | null) => {
    if (item) interactionBaseline.current = { layout: toItems(layout), activeId: item.i }
  }
  const releaseBaseline = () => {
    interactionBaseline.current = null
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
      type: null,
      allowOverlap: false,
      compact(layout) {
        const baseline = interactionBaseline.current
        if (!baseline) return [...layout]
        const resolved = new Map(
          resolveInteraction(baseline.layout, baseline.activeId, toItems(layout)).map((item) => [
            item.i,
            item,
          ]),
        )
        return layout.map((item) => {
          const r = resolved.get(item.i)
          return r ? { ...item, x: r.x, y: r.y, w: r.w, h: r.h } : item
        })
      },
    }),
    [],
  )

  useEffect(() => () => {
    if (pendingLayout.current) clearTimeout(pendingLayout.current)
  }, [])

  // A dashboard the device remembers may have been deleted on another tablet.
  const active =
    dashboards.find((dashboard) => dashboard.id === byWorkspace[workspaceId]) ?? dashboards[0]

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
            onDragStop={releaseBaseline}
            onResizeStop={releaseBaseline}
            onLayoutChange={(layout: Layout) => {
              if (!isEditing) return
              // Debounced: a drag ends in a flurry of layout callbacks, and each write
              // would otherwise become its own CouchDB revision to replicate. The
              // rubber-band compactor above has already resolved every displaced widget
              // by the time this fires, so there is nothing left to do here but persist.
              if (pendingLayout.current) clearTimeout(pendingLayout.current)
              const items = toItems(layout)
              pendingLayout.current = setTimeout(() => {
                void setLayout(active.id, breakpoint, items)
              }, 400)
            }}
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
