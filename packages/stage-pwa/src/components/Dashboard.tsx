import { useEffect, useMemo, useRef } from 'react'
import { noCompactor, ResponsiveGridLayout, type Layout } from 'react-grid-layout'
import type { Breakpoint, Dashboard as DashboardDoc, LayoutItem } from 'shared-types'
import { capabilityStatusFor } from '../lib/capabilities'
import {
  breakpointFor,
  GRID_COLUMNS,
  GRID_ROWS,
  gridMetrics,
  normalizeLayout,
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
            // The library's default auto-slides every widget up to close any empty row
            // above it - exactly the vertical breathing room a musician might want to
            // leave between two widgets on purpose. normalizeLayout already keeps a
            // valid layout's gaps intact on read; this keeps the live drag from fighting
            // the same gap while it's being created.
            compactor={noCompactor}
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
            onLayoutChange={(layout: Layout) => {
              if (!isEditing) return
              // Debounced: a drag ends in a flurry of layout callbacks, and each write
              // would otherwise become its own CouchDB revision to replicate.
              if (pendingLayout.current) clearTimeout(pendingLayout.current)
              // Only our own LayoutItem fields, not react-grid-layout's interaction
              // bookkeeping (moved, static, ...) - that's meaningless once persisted and
              // just noise the next read has to carry around.
              const items: LayoutItem[] = layout.map(({ i, x, y, w, h, minW, minH }) => ({
                i,
                x,
                y,
                w,
                h,
                ...(minW === undefined ? {} : { minW }),
                ...(minH === undefined ? {} : { minH }),
              }))
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
