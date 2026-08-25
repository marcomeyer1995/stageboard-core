import { useEffect, useMemo, useRef, useState } from 'react'
import { ResponsiveGridLayout, useContainerWidth, type Layout } from 'react-grid-layout'
import type { Breakpoint, Dashboard as DashboardDoc, LayoutItem } from 'shared-types'
import { capabilityStatusFor } from '../lib/capabilities'
import { withWidgetRemoved } from '../lib/dashboardLayout'
import { GRID_COLUMNS } from '../lib/defaultDashboards'
import { useCapabilities } from '../lib/useCapabilities'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useEditModeStore } from '../store/useEditModeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { WIDGET_REGISTRY } from '../widgets/registry'
import { DashboardEditBar } from './DashboardEditBar'
import { WidgetFrame } from './WidgetFrame'

/** docs/07 section 3: phone, tablet portrait, tablet landscape, stage monitor. */
const BREAKPOINT_WIDTHS: Record<Breakpoint, number> = { xl: 1600, lg: 1024, md: 640, sm: 0 }
const COLS: Record<Breakpoint, number> = { xl: GRID_COLUMNS, lg: GRID_COLUMNS, md: GRID_COLUMNS, sm: GRID_COLUMNS }

function layoutFor(dashboard: DashboardDoc, breakpoint: Breakpoint): LayoutItem[] {
  return dashboard.layouts[breakpoint] ?? []
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
  const { width, containerRef, mounted } = useContainerWidth()
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('lg')
  const [configuring, setConfiguring] = useState<string | null>(null)
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

  const configuringWidget = active.widgets.find((widget) => widget.i === configuring)
  const configuringDefinition = configuringWidget
    ? WIDGET_REGISTRY[configuringWidget.type]
    : undefined

  return (
    <div className="flex h-screen flex-col bg-stage">
      {isEditing && <DashboardEditBar dashboard={active} capabilities={capabilities} />}

      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto">
        {mounted && (
          <ResponsiveGridLayout
            width={width}
            layouts={layouts}
            breakpoints={BREAKPOINT_WIDTHS}
            cols={COLS}
            rowHeight={28}
            margin={[8, 8]}
            containerPadding={[8, 8]}
            // Read-only during the show (docs/07): nothing moves unless the Edit-Lock is open.
            dragConfig={{ enabled: isEditing, handle: '.widget-drag-handle' }}
            resizeConfig={{ enabled: isEditing }}
            onBreakpointChange={(next) => setBreakpoint(next as Breakpoint)}
            onLayoutChange={(layout: Layout) => {
              if (!isEditing) return
              // Debounced: a drag ends in a flurry of layout callbacks, and each write
              // would otherwise become its own CouchDB revision to replicate.
              if (pendingLayout.current) clearTimeout(pendingLayout.current)
              const items = layout as LayoutItem[]
              pendingLayout.current = setTimeout(() => {
                void setLayout(active.id, breakpoint, items)
              }, 400)
            }}
          >
            {active.widgets.map((widget) => {
              const definition = WIDGET_REGISTRY[widget.type]
              if (!definition) return <div key={widget.i} />
              const status = capabilityStatusFor(definition.requires, capabilities)
              const { Component } = definition

              return (
                <div key={widget.i}>
                  <WidgetFrame
                    title={definition.title}
                    status={status}
                    isEditing={isEditing}
                    hasConfig={definition.ConfigPanel !== undefined}
                    onConfigure={() => setConfiguring(widget.i)}
                    onRemove={() => removeWidget(widget.i)}
                  >
                    <Component config={widget.config} />
                  </WidgetFrame>
                </div>
              )
            })}
          </ResponsiveGridLayout>
        )}
      </div>

      {configuringWidget && configuringDefinition?.ConfigPanel && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg bg-surface p-4">
            <h2 className="mb-3 text-sm font-bold text-ink">{configuringDefinition.title}</h2>
            <configuringDefinition.ConfigPanel
              config={configuringWidget.config}
              onChange={(next) => updateConfig(configuringWidget.i, next)}
            />
            <button
              type="button"
              onClick={() => setConfiguring(null)}
              className="mt-4 w-full rounded bg-control-strong px-3 py-2 text-sm text-ink hover:bg-control-strong-hover"
            >
              Fertig
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
