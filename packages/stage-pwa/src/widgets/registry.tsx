import { useMemo, type ComponentType } from 'react'
import { z } from 'zod'
import { CAPABILITIES, type CapabilityId, type StageRole } from 'shared-types'
import { ActiveSetlistConfigPanel, ActiveSetlistWidget } from './ActiveSetlistWidget'
import { ActiveSetlistConfigSchema } from './activeSetlistConfig'
import { BackupStatusConfigPanel, BackupStatusWidget } from './BackupStatusWidget'
import { BackupStatusConfigSchema } from './backupStatusConfig'
import { ClickTrackConfigPanel, ClickTrackWidget } from './ClickTrackWidget'
import { ClickTrackConfigSchema } from './clickTrackConfig'
import { ClockConfigPanel, ClockWidget } from './ClockWidget'
import { ClockConfigSchema } from './clockConfig'
import { FestivalClockConfigPanel, FestivalClockWidget, FestivalClockWidgetPreview } from './FestivalClockWidget'
import { FestivalClockConfigSchema } from './festivalClockConfig'
import { ContentFontSizeConfigPanel } from './ContentFontSizeConfigPanel'
import { ContentFontSizeConfigSchema } from './contentFontSizeConfig'
import { CustomTriggerConfigPanel, CustomTriggerWidget } from './CustomTriggerWidget'
import { CustomTriggerConfigSchema } from './customTriggerConfig'
import { DashboardSwitcherConfigPanel, DashboardSwitcherView } from './DashboardSwitcherWidget'
import { DashboardSwitcherConfigSchema } from './dashboardSwitcherConfig'
import { DeviceStatusConfigPanel, DeviceStatusWidget } from './DeviceStatusWidget'
import { DeviceStatusConfigSchema } from './deviceStatusConfig'
import { IemConfigPanel, IemWidget } from './IemWidget'
import { IemConfigSchema } from './iemConfig'
import { LightingCuesWidget } from './LightingCuesWidget'
import { CueGridConfigPanel } from './CueGrid'
import { CueGridConfigSchema } from './cueGridConfig'
import { LiveQueueWidget, LiveQueueWidgetPreview } from './LiveQueueWidget'
import { MidiStatusConfigPanel, MidiStatusWidget } from './MidiStatusWidget'
import { MidiStatusConfigSchema } from './midiStatusConfig'
import { NextSongConfigPanel, NextSongWidget } from './NextSongWidget'
import { NextSongConfigSchema } from './nextSongConfig'
import { PrompterConfigPanel, PrompterWidget } from './PrompterWidget'
import { PrompterConfigSchema } from './prompterConfig'
import { QuickActionsWidget } from './QuickActionsWidget'
import { SeparatorConfigPanel, SeparatorWidget } from './SeparatorWidget'
import { SeparatorConfigSchema } from './separatorConfig'
import { ShowNoteWidget } from './ShowNoteWidget'
import { ShowTransportConfigPanel, ShowTransportWidget } from './ShowTransportWidget'
import { ShowTransportConfigSchema } from './showTransportConfig'
import { SyncCheckConfigPanel, SyncCheckWidget } from './SyncCheckWidget'
import { SyncCheckConfigSchema } from './syncCheckConfig'
import { SystemHealthWidget } from './SystemHealthWidget'
import { ChordReferenceConfigPanel, ChordReferenceWidget } from './ChordReferenceWidget'
import { ChordReferenceConfigSchema } from './chordReferenceConfig'
import { CircleOfFifthsConfigPanel, CircleOfFifthsWidget } from './CircleOfFifthsWidget'
import { CircleOfFifthsConfigSchema } from './circleOfFifthsConfig'
import { LoopTrainerConfigPanel, LoopTrainerWidget } from './LoopTrainerWidget'
import { LoopTrainerConfigSchema } from './loopTrainerConfig'
import { TempoNudgeConfigPanel, TempoNudgeWidget } from './TempoNudgeWidget'
import { TempoNudgeConfigSchema } from './tempoNudgeConfig'
import { TrackOverrideConfigPanel, TrackOverrideWidget } from './TrackOverrideWidget'
import { TrackOverrideConfigSchema } from './trackOverrideConfig'
import { TunerConfigPanel, TunerWidget, TunerWidgetPreview } from './TunerWidget'
import { TunerConfigSchema } from './tunerConfig'
import { MetronomeConfigPanel, VisualMetronomeWidget, VisualMetronomeWidgetPreview } from './VisualMetronomeWidget'
import { MetronomeConfigSchema } from './metronomeConfig'

export interface WidgetSize {
  w: number
  h: number
  minW?: number
  minH?: number
  /** Unset means uncapped (today's behavior) - only set on widgets a stretched-out size
   * would make look broken (a status light the size of half the screen), not on primary
   * content widgets where "as big as the musician wants" is legitimate (#22). */
  maxW?: number
  maxH?: number
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
  | 'reference'
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
  /** A static, store-free stand-in for the Widget Gallery's thumbnail (#22) - only needed
   * when `Component`'s default/empty render depends on real store state that's almost never
   * representative during ordinary Edit-Mode browsing (an empty queue, a mic not yet
   * granted, a song not currently playing). Unset means the gallery renders `Component`
   * itself with no config, which is perfectly representative for most widgets. */
  Preview?: ComponentType
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
  Preview?: ComponentType
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
    // `parse()` (Zod's safeParse) allocates a new object on every call, even for the exact
    // same raw input - without memoizing on the raw `config` prop's own reference, any parent
    // re-render (e.g. Dashboard.tsx's useCapabilities()/useNow() heartbeat, every 5s, with
    // nothing actually changed) would hand every widget a structurally-identical but
    // reference-new config on every tick, forever - silently defeating any child effect/memo
    // keyed on `config` and forcing widgets like Prompter to re-parse their ChordPro content
    // needlessly, all render, all the time (Marco, 2026-09-14).
    Component: ({ config }) => {
      const parsedConfig = useMemo(() => parse(config), [config])
      return <Component config={parsedConfig} />
    },
    ConfigPanel: ConfigPanel
      ? ({ config, onChange }) => {
          const parsedConfig = useMemo(() => parse(config), [config])
          return (
            <ConfigPanel
              config={parsedConfig}
              onChange={(next) => onChange(next as Record<string, unknown>)}
            />
          )
        }
      : undefined,
    Preview: spec.Preview,
  }
}

const DEFINITIONS: WidgetDefinition[] = [
  defineWidget({
    type: 'prompter',
    title: 'Prompter',
    description: 'Text und Akkorde, wahlweise Smooth Scroll oder Paginated View.',
    category: 'performance',
    defaultLayout: { w: 12, h: 16, minW: 3, minH: 6 },
    configSchema: PrompterConfigSchema,
    Component: PrompterWidget,
    ConfigPanel: PrompterConfigPanel,
  }),
  defineWidget({
    type: 'live-queue',
    title: 'Live-Queue',
    description: 'Die nächsten Songs der Setlist, mit "Als nächstes spielen".',
    category: 'performance',
    defaultLayout: { w: 4, h: 12, minW: 3, minH: 4 },
    configSchema: ContentFontSizeConfigSchema,
    Component: LiveQueueWidget,
    ConfigPanel: ContentFontSizeConfigPanel,
    Preview: LiveQueueWidgetPreview,
  }),
  defineWidget({
    type: 'next-song',
    title: 'Next Song',
    description: 'Vorheriger, aktueller und nächster Song, Master-Token, Vor/Zurück.',
    category: 'performance',
    defaultLayout: { w: 7, h: 2, minW: 3, minH: 2, maxH: 6 },
    configSchema: NextSongConfigSchema,
    Component: NextSongWidget,
    ConfigPanel: NextSongConfigPanel,
  }),
  defineWidget({
    type: 'active-setlist',
    title: 'Aktive Setlist',
    description: 'Zeigt, welche Setlist gerade aktiv ist - auch ohne Live-Queue/Next Song.',
    category: 'performance',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6 },
    configSchema: ActiveSetlistConfigSchema,
    Component: ActiveSetlistWidget,
    ConfigPanel: ActiveSetlistConfigPanel,
  }),
  defineWidget({
    type: 'show-transport',
    title: 'Show-Transport',
    description: 'Play/Pause/Stop/Reset für den aktuellen Song - Gig oder Solo Üben, mit oder ohne Backing-Track-Plugin.',
    category: 'performance',
    defaultLayout: { w: 4, h: 3, minW: 3, minH: 2, maxW: 8, maxH: 6 },
    configSchema: ShowTransportConfigSchema,
    Component: ShowTransportWidget,
    ConfigPanel: ShowTransportConfigPanel,
  }),
  defineWidget({
    type: 'visual-metronome',
    title: 'Visueller Metronom',
    description: 'Blitzt im Takt des aktiven Songs (BPM/Taktart), Downbeat farblich abgesetzt.',
    category: 'performance',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6 },
    configSchema: MetronomeConfigSchema,
    Component: VisualMetronomeWidget,
    ConfigPanel: MetronomeConfigPanel,
    Preview: VisualMetronomeWidgetPreview,
  }),
  defineWidget({
    type: 'loop-trainer',
    title: 'Loop-Trainer',
    description: 'Solo Üben: wiederholt einen Abschnitt des Backing-Tracks lückenlos, optional mit steigendem Tempo pro Durchgang (Tonhöhe bleibt).',
    category: 'performance',
    defaultLayout: { w: 4, h: 6, minW: 3, minH: 4, maxW: 8, maxH: 10 },
    configSchema: LoopTrainerConfigSchema,
    Component: LoopTrainerWidget,
    ConfigPanel: LoopTrainerConfigPanel,
  }),
  defineWidget({
    type: 'tempo-nudge',
    title: 'Tempo-Korrektur',
    description: 'Live +/- Anpassung des Klick-/Metronom-Tempos, ohne den Song-BPM zu ändern.',
    category: 'performance',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6 },
    configSchema: TempoNudgeConfigSchema,
    Component: TempoNudgeWidget,
    ConfigPanel: TempoNudgeConfigPanel,
  }),
  defineWidget({
    type: 'click-track',
    title: 'Klick',
    description: 'Synthetisierter Klick/Metronom-Ton, an/aus - läuft auf dem als Klick-Ausgabe eingerichteten Gerät.',
    category: 'performance',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6 },
    configSchema: ClickTrackConfigSchema,
    Component: ClickTrackWidget,
    ConfigPanel: ClickTrackConfigPanel,
  }),
  defineWidget({
    type: 'track-override',
    title: 'Track-Wahl',
    description: 'Wechselt kurzfristig den Backing-Track eines Songs (z.B. "1 Gitarre" statt "keine Gitarre").',
    category: 'performance',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6 },
    configSchema: TrackOverrideConfigSchema,
    Component: TrackOverrideWidget,
    ConfigPanel: TrackOverrideConfigPanel,
  }),
  defineWidget({
    type: 'midi-status',
    title: 'Fußtaster',
    description: 'Status des MIDI-Fußtasters, Sprung zum nächsten Song-Part.',
    requires: [CAPABILITIES.midiInput],
    category: 'performance',
    defaultLayout: { w: 3, h: 2, minW: 2, minH: 2, maxW: 6, maxH: 4 },
    configSchema: MidiStatusConfigSchema,
    Component: MidiStatusWidget,
    ConfigPanel: MidiStatusConfigPanel,
  }),
  defineWidget({
    type: 'dashboard-switcher',
    title: 'Dashboard-Umschalter',
    description: 'Große Buttons, um zwischen den Dashboards zu wechseln.',
    category: 'performance',
    defaultLayout: { w: 12, h: 2, minW: 2, minH: 2, maxH: 4 },
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
    configSchema: IemConfigSchema,
    Component: IemWidget,
    ConfigPanel: IemConfigPanel,
  }),
  defineWidget({
    type: 'quick-actions',
    title: 'Quick Actions',
    description: 'Große Buttons für Ad-Hoc Show Cues.',
    requires: [CAPABILITIES.showControl],
    category: 'show-control',
    defaultLayout: { w: 6, h: 8, minW: 3, minH: 4 },
    configSchema: CueGridConfigSchema,
    Component: QuickActionsWidget,
    ConfigPanel: CueGridConfigPanel,
  }),
  defineWidget({
    type: 'lighting-cues',
    title: 'Lighting Cues',
    description: 'Große Buttons für Licht-Cues am DMX-Pult.',
    requires: [CAPABILITIES.lighting],
    category: 'show-control',
    defaultLayout: { w: 6, h: 8, minW: 3, minH: 4 },
    configSchema: CueGridConfigSchema,
    Component: LightingCuesWidget,
    ConfigPanel: CueGridConfigPanel,
  }),
  defineWidget({
    type: 'system-health',
    title: 'System-Status',
    description: 'Ampel-Übersicht aller Plugin-Capabilities, für Setup/Soundcheck.',
    category: 'system-crew',
    relevantRoles: ['crew'],
    defaultLayout: { w: 4, h: 6, minW: 3, minH: 3 },
    configSchema: ContentFontSizeConfigSchema,
    Component: SystemHealthWidget,
    ConfigPanel: ContentFontSizeConfigPanel,
  }),
  defineWidget({
    type: 'sync-check',
    title: 'Sync-Check',
    description: 'Blitzt im Takt der Server-Uhr - zwei Geräte nebeneinander halten und prüfen, ob sie synchron blinken.',
    category: 'system-crew',
    relevantRoles: ['crew'],
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6 },
    configSchema: SyncCheckConfigSchema,
    Component: SyncCheckWidget,
    ConfigPanel: SyncCheckConfigPanel,
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
    Preview: TunerWidgetPreview,
  }),
  defineWidget({
    type: 'show-notes',
    title: 'Show-Notizen',
    description: 'Live-Notizen von Band und Crew, zum Nachbericht sichtbar.',
    category: 'system-crew',
    defaultLayout: { w: 4, h: 8, minW: 3, minH: 4 },
    configSchema: ContentFontSizeConfigSchema,
    Component: ShowNoteWidget,
    ConfigPanel: ContentFontSizeConfigPanel,
  }),
  defineWidget({
    type: 'backup-status',
    title: 'Backup-Status',
    description: 'Glanceable Indikator, ob das Backup-Plugin erreichbar ist.',
    requires: [CAPABILITIES.backup],
    category: 'system-crew',
    defaultLayout: { w: 3, h: 2, minW: 2, minH: 2, maxW: 6, maxH: 4 },
    configSchema: BackupStatusConfigSchema,
    Component: BackupStatusWidget,
    ConfigPanel: BackupStatusConfigPanel,
  }),
  defineWidget({
    type: 'festival-clock',
    title: 'Festival-Uhr',
    description: 'Voraussichtliches Ende der restlichen Setlist - wird rot, wenn das Ende nach der Zielzeit (Curfew) liegt.',
    category: 'performance',
    defaultLayout: { w: 4, h: 3, minW: 3, minH: 2 },
    configSchema: FestivalClockConfigSchema,
    Component: FestivalClockWidget,
    ConfigPanel: FestivalClockConfigPanel,
    Preview: FestivalClockWidgetPreview,
  }),
  defineWidget({
    type: 'clock',
    title: 'Uhr',
    description: 'Große, gut lesbare Digitaluhr für die Bühne.',
    category: 'utility',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 },
    configSchema: ClockConfigSchema,
    Component: ClockWidget,
    ConfigPanel: ClockConfigPanel,
  }),
  defineWidget({
    type: 'separator',
    title: 'Trenner',
    description: 'Eine einfache Linie, um Dashboard-Bereiche optisch abzugrenzen.',
    category: 'utility',
    defaultLayout: { w: 12, h: 1, minW: 1, minH: 1 },
    configSchema: SeparatorConfigSchema,
    Component: SeparatorWidget,
    ConfigPanel: SeparatorConfigPanel,
  }),
  defineWidget({
    type: 'device-status',
    title: 'Geräte-Status',
    description: 'Live-Verbindungsstatus eines einzelnen, konkret ausgewählten Geräts.',
    category: 'utility',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 },
    configSchema: DeviceStatusConfigSchema,
    Component: DeviceStatusWidget,
    ConfigPanel: DeviceStatusConfigPanel,
  }),
  defineWidget({
    type: 'custom-trigger',
    title: 'Trigger-Button',
    description: 'Frei konfigurierbarer Button (latching oder momentary) für ein Zielgerät.',
    category: 'show-control',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 },
    configSchema: CustomTriggerConfigSchema,
    Component: CustomTriggerWidget,
    ConfigPanel: CustomTriggerConfigPanel,
  }),
  defineWidget({
    type: 'chord-reference',
    title: 'Akkord-Nachschlagen',
    description: 'Grundton und Akkordart wählen: Noten, Intervalle, Gitarren-Griffbild und Klaviatur.',
    category: 'reference',
    defaultLayout: { w: 5, h: 7, minW: 3, minH: 4, maxW: 10, maxH: 12 },
    configSchema: ChordReferenceConfigSchema,
    Component: ChordReferenceWidget,
    ConfigPanel: ChordReferenceConfigPanel,
  }),
  defineWidget({
    type: 'circle-of-fifths',
    title: 'Quintenzirkel',
    description: 'Tonart antippen: Paralleltonart, Dominante, Subdominante und Vorzeichen auf einen Blick.',
    category: 'reference',
    defaultLayout: { w: 4, h: 7, minW: 3, minH: 5, maxW: 8, maxH: 12 },
    configSchema: CircleOfFifthsConfigSchema,
    Component: CircleOfFifthsWidget,
    ConfigPanel: CircleOfFifthsConfigPanel,
  }),
]

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = Object.fromEntries(
  DEFINITIONS.map((definition) => [definition.type, definition]),
)

export const ALL_WIDGETS: WidgetDefinition[] = DEFINITIONS
