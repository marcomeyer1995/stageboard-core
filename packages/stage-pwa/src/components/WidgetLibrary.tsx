import { useMemo, useState } from 'react'
import { randomId } from '../lib/id'
import type { CapabilityId, Dashboard, StageRole } from 'shared-types'
import type { CapabilityStatus } from '../lib/capabilities'
import { availableWidgets, GRID_COLUMNS, withWidgetAppended } from '../lib/dashboardLayout'
import { ALL_WIDGETS, type WidgetCategory, type WidgetDefinition } from '../widgets/registry'
import { WidgetPreviewErrorBoundary } from './WidgetPreviewErrorBoundary'

const CATEGORY_LABEL: Record<WidgetCategory, string> = {
  performance: 'Performance',
  monitoring: 'Monitoring',
  'show-control': 'Show Control',
  'system-crew': 'System & Crew',
  utility: 'Utility',
  reference: 'Nachschlagen',
  'post-show': 'Nach der Show',
}

const CATEGORY_ORDER: WidgetCategory[] = [
  'performance',
  'monitoring',
  'show-control',
  'system-crew',
  'utility',
  'reference',
  'post-show',
]

interface WidgetLibraryProps {
  dashboard: Dashboard
  capabilities: Map<CapabilityId, CapabilityStatus>
  activeRoles?: StageRole[]
  onAdd: (dashboard: Dashboard) => void
  onClose: () => void
}

/**
 * The "+ Widget" gallery: everything the band's plugins support (docs/07 section 4),
 * grouped by category and filtered by a text search - both on top of, not instead of,
 * the existing capability/role gating in availableWidgets().
 *
 * A fixed-position overlay (#22), not inline in DashboardEditBar's flex row anymore - the
 * same backdrop pattern DashboardManager.tsx already uses (fixed inset-0, backdrop click
 * closes, inner panel stops propagation) - so opening it no longer pushes the grid below
 * out of the way.
 */
export function WidgetLibrary({ dashboard, capabilities, activeRoles, onAdd, onClose }: WidgetLibraryProps) {
  const [search, setSearch] = useState('')

  const available = useMemo(
    () => availableWidgets(ALL_WIDGETS, capabilities, activeRoles),
    [capabilities, activeRoles],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return available
    return available.filter(
      (definition) =>
        definition.title.toLowerCase().includes(term) ||
        definition.description.toLowerCase().includes(term),
    )
  }, [available, search])

  const grouped = useMemo(() => {
    const byCategory = new Map<WidgetCategory, WidgetDefinition[]>()
    for (const definition of filtered) {
      const list = byCategory.get(definition.category) ?? []
      list.push(definition)
      byCategory.set(definition.category, list)
    }
    return CATEGORY_ORDER.map((category) => [category, byCategory.get(category) ?? []] as const).filter(
      ([, list]) => list.length > 0,
    )
  }, [filtered])

  function add(definition: WidgetDefinition) {
    onAdd(
      withWidgetAppended(
        dashboard,
        definition.type,
        { ...definition.defaultLayout, w: Math.min(definition.defaultLayout.w, GRID_COLUMNS) },
        `${definition.type}-${randomId().slice(0, 8)}`,
      ),
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-sb border border-line bg-surface p-4 shadow-sb"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Widget hinzufügen</h2>
          <button
            type="button"
            onClick={onClose}
            title="Schließen"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sb-sm text-ink-muted hover:bg-control-hover hover:text-ink"
          >
            ✕
          </button>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Widget suchen…"
          className="rounded-sb-sm bg-control px-2 py-1 text-ink placeholder:text-ink-faint"
        />

        {grouped.length === 0 && <p className="text-ink-faint">Kein Widget gefunden.</p>}

        {grouped.map(([category, definitions]) => (
          <div key={category} className="flex flex-col gap-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-ink-faint">
              {CATEGORY_LABEL[category]}
            </p>
            <div className="flex flex-wrap gap-2">
              {definitions.map((definition) => (
                <div
                  key={definition.type}
                  role="button"
                  tabIndex={0}
                  title={definition.description}
                  onClick={() => add(definition)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      add(definition)
                    }
                  }}
                  className="flex w-44 cursor-pointer flex-col overflow-hidden rounded-sb border border-line bg-control text-left hover:bg-control-hover"
                >
                  {/* `inert`, not just pointer-events-none: a live preview can render a
                      widget's own real controls (e.g. TunerWidget's "An" button) - inert
                      strips both mouse AND keyboard/focus reachability, so tabbing through
                      the gallery can never land on (and Enter-activate) a control buried
                      inside a preview, only on this tile's own outer handler. */}
                  <div
                    className="pointer-events-none h-24 w-full overflow-hidden border-b border-line bg-stage"
                    ref={(el) => {
                      if (el) el.inert = true
                    }}
                  >
                    <WidgetPreviewErrorBoundary
                      fallback={
                        <div className="flex h-full items-center justify-center text-center text-[10px] text-ink-faint">
                          Keine Vorschau
                        </div>
                      }
                    >
                      {definition.Preview ? <definition.Preview /> : <definition.Component config={undefined} />}
                    </WidgetPreviewErrorBoundary>
                  </div>
                  <div className="px-3 py-2">
                    <span className="block font-semibold">{definition.title}</span>
                    <span className="block text-[10px] text-ink-muted">{definition.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
