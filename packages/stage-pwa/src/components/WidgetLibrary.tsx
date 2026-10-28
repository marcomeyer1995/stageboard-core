import { useTranslation } from 'react-i18next'
import { useMemo, useState } from 'react'
import { randomId } from '../lib/id'
import { searchRank } from '../lib/widgetSearch'
import type { Breakpoint, CapabilityId, Dashboard, StageRole } from 'shared-types'
import type { CapabilityStatus } from '../lib/capabilities'
import {
  availableWidgets,
  BREAKPOINT_CANVAS,
  GRID_COLUMNS,
  GRID_ROWS,
  hasRoomFor,
  isDashboardAvailableInMode,
  withWidgetAppended,
} from '../lib/dashboardLayout'
import { ALL_WIDGETS, type StageTier, type WidgetCategory, type WidgetDefinition } from '../widgets/registry'
import { WidgetPreviewErrorBoundary } from './WidgetPreviewErrorBoundary'
import { useBackHandler } from '../lib/backNavigation'
import { INPUT } from './ui/styles'
import { Button, Dialog, InfoHint } from './ui'
import { useWidgetText } from '../lib/widgetText'


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
  /** The grid the device shows right now - where "is there room" is checked. */
  breakpoint: Breakpoint
  capabilities: Map<CapabilityId, CapabilityStatus>
  activeRoles?: StageRole[]
  onAdd: (dashboard: Dashboard) => void
  /** "Neues Dashboard mit diesem Widget" - offered when the current one has no room. */
  onAddToNewDashboard: (definition: WidgetDefinition) => void
  onClose: () => void
}

/** Preview card size, px (w-44 x h-28). */
const PREVIEW_W = 176
const PREVIEW_H = 112

/**
 * A widget's live preview rendered at its real default size on the portrait tablet grid and
 * scaled down as a whole, instead of squeezing the widget into the card - its own size-dependent
 * layout then shows what it will really look like (GUI audit 2026-09-26: Show-Transport's
 * buttons read "PLAPAUSTOIRES" when fitted into the card).
 */
function ScaledPreview({ definition }: { definition: WidgetDefinition }) {
  const canvas = BREAKPOINT_CANVAS.md
  const width = (Math.min(definition.defaultLayout.w, GRID_COLUMNS) * canvas.w) / GRID_COLUMNS
  const height = (Math.min(definition.defaultLayout.h, GRID_ROWS) * canvas.h) / GRID_ROWS
  const scale = Math.min(PREVIEW_W / width, PREVIEW_H / height, 1)
  return (
    <div
      className="absolute left-1/2 top-1/2 flex flex-col overflow-hidden rounded-container border border-line bg-surface p-4"
      style={{ width, height, transform: `translate(-50%, -50%) scale(${scale})` }}
    >
      <div className="min-h-0 flex-1">
        {definition.Preview ? <definition.Preview /> : <definition.Component config={undefined} />}
      </div>
    </div>
  )
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
/** Badge per stage tier (registry.tsx StageTier); layout-only widgets get none. */
/** The badge for how a widget is used on stage (registry StageTier) - names from 2026-10-28
 * (Marco: "Gig-Blick" said nothing): Im Song / Zwischen Songs / Probe. */
const TIER_BADGE: Record<StageTier, 'gig' | 'glance' | 'rehearsal' | null> = { gig: 'gig', glance: 'glance', rehearsal: 'rehearsal', layout: null }

export function WidgetLibrary({
  dashboard,
  breakpoint,
  capabilities,
  activeRoles,
  onAdd,
  onAddToNewDashboard,
  onClose,
}: WidgetLibraryProps) {
  useBackHandler(onClose)
  // A rehearsal widget is fine anywhere; on a dashboard that is also offered in Gig mode it
  // just gets a note, never a block (Marco, 2026-09-27: keep the gig dashboards lean by choice).
  const offeredInGig = isDashboardAvailableInMode(dashboard, 'gig')
  const [search, setSearch] = useState('')
  // A widget that does not fit at full size waits here for the user's choice.
  const [noRoom, setNoRoom] = useState<WidgetDefinition | null>(null)
  useBackHandler(noRoom ? () => setNoRoom(null) : null)

  // Names and descriptions in this device's language (#456) - search, cards and dialogs alike.
  const widgetText = useWidgetText()
  const { t: tc } = useTranslation('common')
  const available = useMemo(
    () =>
      availableWidgets(ALL_WIDGETS, capabilities, activeRoles).map((definition) => ({
        ...definition,
        title: widgetText.title(definition),
        description: widgetText.description(definition),
      })),
    [capabilities, activeRoles, widgetText],
  )

  const term = search.trim().toLowerCase()

  // While searching: one list ranked by title match, not the categories - "Uhr" used to list
  // Festival-Uhr first and "Klick" Tempo-Korrektur, whose descriptions mention them (GUI audit).
  const ranked = useMemo(() => {
    if (!term) return []
    return available
      .map((definition) => ({ definition, rank: searchRank(definition, term) }))
      .filter((entry): entry is { definition: WidgetDefinition; rank: number } => entry.rank !== null)
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.definition)
  }, [available, term])

  const grouped = useMemo(() => {
    if (term) return ranked.length > 0 ? [['Treffer', ranked] as const] : []
    const byCategory = new Map<WidgetCategory, WidgetDefinition[]>()
    for (const definition of available) {
      const list = byCategory.get(definition.category) ?? []
      list.push(definition)
      byCategory.set(definition.category, list)
    }
    return CATEGORY_ORDER.map((category) => [tc(`widgetLibrary.categories.${category}`), byCategory.get(category) ?? []] as const).filter(
      ([, list]) => list.length > 0,
    )
  }, [available, ranked, term, tc])

  function add(definition: WidgetDefinition) {
    if (!hasRoomFor(dashboard.layouts[breakpoint] ?? [], definition.defaultLayout)) {
      setNoRoom(definition)
      return
    }
    addHere(definition)
  }

  function addHere(definition: WidgetDefinition) {
    onAdd(
      withWidgetAppended(
        dashboard,
        definition.type,
        { ...definition.defaultLayout, w: Math.min(definition.defaultLayout.w, GRID_COLUMNS) },
        `${definition.type}-${randomId().slice(0, 8)}`,
      ),
    )
  }

  // Picking a widget adds it and closes - so the way out at the bottom is "Abbrechen" (docs/15 D6).
  return (
    <Dialog title={tc('widgetLibrary.title')} size="l" closeLabel={tc('actions.cancel')} onClose={onClose}>

        {/* flex-shrink-0: the panel is a scrolling flex column, which shrank the field to 19px on
            the tablet despite h-touch. */}
        <div className="flex flex-shrink-0 items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tc('widgetLibrary.search')}
            className={`h-touch flex-1 min-w-0 px-3 placeholder:text-ink-faint ${INPUT}`}
          />
          {/* What the badges on the cards mean. */}
          <InfoHint text={tc('tiers.explain')} />
        </div>

        {noRoom && (
          // Its own dialog above the library: the tapped card can be far down the scrolled list.
          <Dialog
            title={tc('widgetLibrary.noRoomTitle', { title: noRoom.title })}
            onClose={() => setNoRoom(null)}
            actions={
              <>
                <Button onClick={() => setNoRoom(null)}>{tc('actions.cancel')}</Button>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button onClick={() => addHere(noRoom)}>{tc('widgetLibrary.addHereAnyway')}</Button>
                  <Button variant="primary" onClick={() => onAddToNewDashboard(noRoom)}>
                    {tc('widgetLibrary.newDashboard')}
                  </Button>
                </div>
              </>
            }
          >
            <p role="alert" className="text-base text-ink">
              {tc('widgetLibrary.noRoomText', { w: noRoom.defaultLayout.w, h: noRoom.defaultLayout.h })}
            </p>
          </Dialog>
        )}

        {grouped.length === 0 && <p className="text-ink-faint">{tc('widgetLibrary.noneFound')}</p>}

        {grouped.map(([label, definitions]) => (
          <div key={label} className="flex flex-col gap-1">
            <h3 className="text-xs font-bold uppercase tracking-widest text-ink-faint">{label}</h3>
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
                  className="flex w-44 cursor-pointer flex-col overflow-hidden rounded-control border border-line bg-control text-left [@media(hover:hover)]:hover:bg-control-hover"
                >
                  {/* `inert`, not just pointer-events-none: a live preview can render a
                      widget's own real controls (e.g. TunerWidget's "An" button) - inert
                      strips both mouse AND keyboard/focus reachability, so tabbing through
                      the gallery can never land on (and Enter-activate) a control buried
                      inside a preview, only on this tile's own outer handler. */}
                  <div
                    className="pointer-events-none relative h-28 w-full overflow-hidden border-b border-line bg-stage"
                    ref={(el) => {
                      if (el) el.inert = true
                    }}
                  >
                    <WidgetPreviewErrorBoundary
                      fallback={
                        <div className="flex h-full items-center justify-center text-center text-xs text-ink-faint">
                          {tc('widgetLibrary.noPreview')}
                        </div>
                      }
                    >
                      <ScaledPreview definition={definition} />
                    </WidgetPreviewErrorBoundary>
                  </div>
                  <div className="flex flex-col gap-1 px-3 py-2">
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-semibold">{definition.title}</span>
                      {TIER_BADGE[definition.stageTier] && (
                        <span className="whitespace-nowrap rounded-control bg-control-strong px-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft">
                          {tc(`tiers.${TIER_BADGE[definition.stageTier]!}`)}
                        </span>
                      )}
                    </span>
                    <span className="block text-sm text-ink-muted">{definition.description}</span>
                    {definition.stageTier === 'rehearsal' && offeredInGig && (
                      <span className="block text-sm text-accent">
                        {tc('widgetLibrary.rehearsalInGig')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
    </Dialog>
  )
}
