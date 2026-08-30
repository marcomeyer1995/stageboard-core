import { useMemo, useState } from 'react'
import { randomId } from '../lib/id'
import type { CapabilityId, Dashboard, StageRole } from 'shared-types'
import type { CapabilityStatus } from '../lib/capabilities'
import { availableWidgets, GRID_COLUMNS, withWidgetAppended } from '../lib/dashboardLayout'
import { ALL_WIDGETS, type WidgetCategory, type WidgetDefinition } from '../widgets/registry'

const CATEGORY_LABEL: Record<WidgetCategory, string> = {
  performance: 'Performance',
  monitoring: 'Monitoring',
  'show-control': 'Show Control',
  'system-crew': 'System & Crew',
  utility: 'Utility',
  'post-show': 'Nach der Show',
}

const CATEGORY_ORDER: WidgetCategory[] = [
  'performance',
  'monitoring',
  'show-control',
  'system-crew',
  'utility',
  'post-show',
]

interface WidgetLibraryProps {
  dashboard: Dashboard
  capabilities: Map<CapabilityId, CapabilityStatus>
  activeRoles?: StageRole[]
  onAdd: (dashboard: Dashboard) => void
}

/**
 * The "+ Widget" panel: everything the band's plugins support (docs/07 section 4),
 * grouped by category and filtered by a text search - both on top of, not instead of,
 * the existing capability/role gating in availableWidgets().
 */
export function WidgetLibrary({ dashboard, capabilities, activeRoles, onAdd }: WidgetLibraryProps) {
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
    <div className="flex w-full flex-col gap-3 pt-2">
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
              <button
                key={definition.type}
                type="button"
                title={definition.description}
                onClick={() => add(definition)}
                className="rounded-sb-sm bg-control px-3 py-2 text-left text-ink hover:bg-control-hover"
              >
                <span className="block font-semibold">{definition.title}</span>
                <span className="block text-[10px] text-ink-muted">{definition.description}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
