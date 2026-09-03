import type { ComponentType } from 'react'
import { z } from 'zod'
import { CAPABILITIES, type CapabilityId, type StageRole } from 'shared-types'
import { ActiveSetlistWidget } from './ActiveSetlistWidget'
import { BackupStatusWidget } from './BackupStatusWidget'
import { DashboardSwitcherConfigPanel, DashboardSwitcherView } from './DashboardSwitcherWidget'
import { DashboardSwitcherConfigSchema } from './dashboardSwitcherConfig'
import { IemWidget } from './IemWidget'
import { LightingCuesWidget } from './LightingCuesWidget'
import { LiveQueueWidget } from './LiveQueueWidget'
import { MidiStatusWidget } from './MidiStatusWidget'
import { NextSongWidget } from './NextSongWidget'
import { PrompterWidget } from './PrompterWidget'
import { QuickActionsWidget } from './QuickActionsWidget'
import { ShowNoteWidget } from './ShowNoteWidget'
import { ShowTransportWidget } from './ShowTransportWidget'
import { SyncCheckWidget } from './SyncCheckWidget'
import { SystemHealthWidget } from './SystemHealthWidget'
import { TrackOverrideWidget } from './TrackOverrideWidget'
import { TunerConfigPanel, TunerWidget } from './TunerWidget'
import { TunerConfigSchema } from './tunerConfig'

export interface WidgetSize {
  w: number
  h: number
  minW?: number
  minH?: number
}

/**
 * Fixed taxonomy for the widget library's grouping - unlike CapabilityId/role, this is
 * StageBoard's own browsing structure, not something community plugins need to extend.
 */
export type WidgetCategory =
  | 'performance'
  | 'monitoring'
  | 'show-control'
  | 'system-crew'
  | 'utility'
  | 'post-show'

/** A widget as the dashboard grid sees it: config already parsed, type parameter erased. */
export interface WidgetDefinition {
  type: string
  title: string
  description: string
  /** Capabilities this widget needs. Empty means core - it can never grey out. */
  requires: CapabilityId[]
  category: WidgetCategory
  /** Roles this widget is relevant to. Unset means relevant to everyone. */
  relevantRoles?: StageRole[]
  defaultLayout: WidgetSize
  Component: ComponentType<{ config: unknown }>
  ConfigPanel?: ComponentType<{
    config: unknown
    onChange: (next: Record<string, unknown>) => void
  }>
}

interface WidgetSpec<C> {
  type: string
  title: string
  description: string
  requires?: CapabilityId[]
  category: WidgetCategory
  relevantRoles?: StageRole[]
  defaultLayout: WidgetSize
  configSchema?: z.ZodType<C>
  Component: ComponentType<{ config: C }>
  ConfigPanel?: ComponentType<{ config: C; onChange: (next: C) => void }>
}

/**
 * Wraps a typed widget into the erased shape the grid stores. Config is parsed here, once,
 * with a fallback to the schema's defaults - a dashboard document that was written by an
 * older (or newer) version must never crash the live view.
 */
function defineWidget<C>(spec: WidgetSpec<C>): WidgetDefinition {
  const parse = (raw: unknown): C => {
    if (!spec.configSchema) return raw as C
    const parsed = spec.configSchema.safeParse(raw ?? {})
    if (parsed.success) return parsed.data
    return spec.configSchema.parse({})
  }

  const { Component, ConfigPanel } = spec

  return {
    type: spec.type,
    title: spec.title,
    description: spec.description,
    requires: spec.requires ?? [],
    category: spec.category,
    relevantRoles: spec.relevantRoles,
    defaultLayout: spec.defaultLayout,
    Component: ({ config }) => <Component config={parse(config)} />,
    ConfigPanel: ConfigPanel
      ? ({ config, onChange }) => (
          <ConfigPanel
            config={parse(config)}
            onChange={(next) => onChange(next as Record<string, unknown>)}
          />
        )
      : undefined,
  }
}

const DEFINITIONS: WidgetDefinition[] = [
  defineWidget({
    type: 'prompter',
    title: 'Prompter',
    description: 'Text und Akkorde, wahlweise Smooth Scroll oder Paginated View.',
    category: 'performance',
    defaultLayout: { w: 12, h: 16, minW: 3, minH: 6 },
    Component: PrompterWidget,
  }),
  defineWidget({
    type: 'live-queue',
    title: 'Live-Queue',
    description: 'Die nächsten Songs der Setlist, mit "Als nächstes spielen".',
    category: 'performance',
    defaultLayout: { w: 4, h: 12, minW: 3, minH: 4 },
    Component: LiveQueueWidget,
  }),
  defineWidget({
    type: 'next-song',
    title: 'Next Song',
    description: 'Vorheriger, aktueller und nächster Song, Master-Token, Vor/Zurück.',
    category: 'performance',
    defaultLayout: { w: 7, h: 2, minW: 3, minH: 2 },
    Component: NextSongWidget,
  }),
  defineWidget({
    type: 'active-setlist',
    title: 'Aktive Setlist',
    description: 'Zeigt, welche Setlist gerade aktiv ist - auch ohne Live-Queue/Next Song.',
    category: 'performance',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 },
    Component: ActiveSetlistWidget,
  }),
  defineWidget({
    type: 'show-transport',
    title: 'Show-Transport',
    description: 'Play/Pause/Stop/Reset für den aktuellen Song - Gig oder Solo Üben, mit oder ohne Backing-Track-Plugin.',
    category: 'performance',
    defaultLayout: { w: 4, h: 3, minW: 3, minH: 2 },
    Component: ShowTransportWidget,
  }),
  defineWidget({
    type: 'track-override',
    title: 'Track-Wahl',
    description: 'Wechselt kurzfristig den Backing-Track eines Songs (z.B. "1 Gitarre" statt "keine Gitarre").',
    category: 'performance',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 },
    Component: TrackOverrideWidget,
  }),
  defineWidget({
    type: 'midi-status',
    title: 'Fußtaster',
    description: 'Status des MIDI-Fußtasters, Sprung zum nächsten Song-Part.',
    requires: [CAPABILITIES.midiInput],
    category: 'performance',
    defaultLayout: { w: 3, h: 2, minW: 2, minH: 2 },
    Component: MidiStatusWidget,
  }),
  defineWidget({
    type: 'dashboard-switcher',
    title: 'Dashboard-Umschalter',
    description: 'Große Buttons, um zwischen den Dashboards zu wechseln.',
    category: 'performance',
    defaultLayout: { w: 12, h: 2, minW: 2, minH: 2 },
    configSchema: DashboardSwitcherConfigSchema,
    Component: DashboardSwitcherView,
    ConfigPanel: DashboardSwitcherConfigPanel,
  }),
  defineWidget({
    type: 'iem-more-me',
    title: 'More Me (IEM)',
    description: 'Eigene Fader für den In-Ear-Mix.',
    requires: [CAPABILITIES.mixer],
    category: 'monitoring',
    defaultLayout: { w: 6, h: 8, minW: 3, minH: 5 },
    Component: IemWidget,
  }),
  defineWidget({
    type: 'quick-actions',
    title: 'Quick Actions',
    description: 'Große Buttons für Ad-Hoc Show Cues.',
    requires: [CAPABILITIES.showControl],
    category: 'show-control',
    defaultLayout: { w: 6, h: 8, minW: 3, minH: 4 },
    Component: QuickActionsWidget,
  }),
  defineWidget({
    type: 'lighting-cues',
    title: 'Lighting Cues',
    description: 'Große Buttons für Licht-Cues am DMX-Pult.',
    requires: [CAPABILITIES.lighting],
    category: 'show-control',
    defaultLayout: { w: 6, h: 8, minW: 3, minH: 4 },
    Component: LightingCuesWidget,
  }),
  defineWidget({
    type: 'system-health',
    title: 'System-Status',
    description: 'Ampel-Übersicht aller Plugin-Capabilities, für Setup/Soundcheck.',
    category: 'system-crew',
    relevantRoles: ['crew'],
    defaultLayout: { w: 4, h: 6, minW: 3, minH: 3 },
    Component: SystemHealthWidget,
  }),
  defineWidget({
    type: 'sync-check',
    title: 'Sync-Check',
    description: 'Blitzt im Takt der Server-Uhr - zwei Geräte nebeneinander halten und prüfen, ob sie synchron blinken.',
    category: 'system-crew',
    relevantRoles: ['crew'],
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 },
    Component: SyncCheckWidget,
  }),
  defineWidget({
    type: 'tuner',
    title: 'Stimmgerät',
    description: 'Chromatisches Stimmgerät über das Mikrofon des Tablets.',
    category: 'utility',
    // A tuner that's been squeezed down to something like 4x4 grid units is illegible on
    // stage - there's no useful "small" size for this widget the way there is for, say, a
    // status light. minW/minH are set high enough that even the smallest allowed size
    // still reads at a glance from arm's length.
    defaultLayout: { w: 6, h: 14, minW: 6, minH: 12 },
    configSchema: TunerConfigSchema,
    Component: TunerWidget,
    ConfigPanel: TunerConfigPanel,
  }),
  defineWidget({
    type: 'show-notes',
    title: 'Show-Notizen',
    description: 'Live-Notizen von Band und Crew, zum Nachbericht sichtbar.',
    category: 'system-crew',
    defaultLayout: { w: 4, h: 8, minW: 3, minH: 4 },
    Component: ShowNoteWidget,
  }),
  defineWidget({
    type: 'backup-status',
    title: 'Backup-Status',
    description: 'Glanceable Indikator, ob das Backup-Plugin erreichbar ist.',
    requires: [CAPABILITIES.backup],
    category: 'system-crew',
    defaultLayout: { w: 3, h: 2, minW: 2, minH: 2 },
    Component: BackupStatusWidget,
  }),
]

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = Object.fromEntries(
  DEFINITIONS.map((definition) => [definition.type, definition]),
)

export const ALL_WIDGETS: WidgetDefinition[] = DEFINITIONS
