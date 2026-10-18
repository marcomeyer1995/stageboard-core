import type { WidgetPart } from '../lib/widgetParts'
import { ReadyCheckWidget } from './ReadyCheckWidget'
import { SectionJumpConfigPanel, SectionJumpWidget } from './SectionJumpWidget'
import { useMemo, type ComponentType } from 'react'
import { z } from 'zod'
import { CAPABILITIES, type CapabilityId, type StageRole } from 'shared-types'
import { ActiveSetlistConfigPanel, ActiveSetlistWidget } from './ActiveSetlistWidget'
import { ActiveSetlistConfigSchema } from './activeSetlistConfig'
import { AudioMixConfigPanel, AudioMixWidget } from './AudioMixWidget'
import { AudioMixConfigSchema } from './audioMixConfig'
import { StemsConfigPanel, StemsWidget } from './StemsWidget'
import { StemsConfigSchema } from './stemsConfig'
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
import { StageMessengerConfigPanel, StageMessengerWidget } from './StageMessengerWidget'
import { StageMessengerConfigSchema } from './stageMessengerConfig'

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
/**
 * How a widget is used, which sets the size requirements it has to meet (GUI audit 2026-09-26,
 * tiers agreed with Marco 2026-09-27):
 * - `gig`: operated or read mid-song, at arm's length, under stress - show actions >= 72px
 *   (--sb-touch-primary), other targets >= 56px (--sb-touch), text >= 16px, key readouts
 *   (time, BPM, state) >= 24px.
 * - `glance`: on stage, but only glanced at or used between songs - text >= 16px, targets >= 48px.
 * - `rehearsal`: rehearsal / practice / preparation only - normal tablet ergonomics (text floor
 *   16px from lib/stageSize.ts, targets >= 44px), density allowed.
 * - `layout`: structure only (Trenner), no content.
 * The widget library shows it as a badge, and hints when a rehearsal widget lands on a
 * dashboard that is also offered in Gig mode.
 */
export type StageTier = 'gig' | 'glance' | 'rehearsal' | 'layout'

export interface WidgetDefinition {
  type: string
  title: string
  description: string
  /** Capabilities this widget needs. Empty means core - it can never grey out. */
  requires: CapabilityId[]
  category: WidgetCategory
  /** How much stage usability this widget owes - see StageTier. */
  stageTier: StageTier
  /** Roles this widget is relevant to. Unset means relevant to everyone. */
  relevantRoles?: StageRole[]
  defaultLayout: WidgetSize
  /** Information the widget can leave out - one "Anzeigen" chip each in its ⋯ menu (lib/widgetParts). */
  parts?: readonly WidgetPart[]
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
  stageTier: StageTier
  relevantRoles?: StageRole[]
  defaultLayout: WidgetSize
  parts?: readonly WidgetPart[]
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
    stageTier: spec.stageTier,
    relevantRoles: spec.relevantRoles,
    defaultLayout: spec.defaultLayout,
    parts: spec.parts,
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
    stageTier: 'gig',
    defaultLayout: { w: 12, h: 16, minW: 3, minH: 6 },
    parts: [
      { id: 'title', label: 'Titel' },
      { id: 'artist', label: 'Interpret' },
      { id: 'key', label: 'Tonart' },
    ],
    configSchema: PrompterConfigSchema,
    Component: PrompterWidget,
    ConfigPanel: PrompterConfigPanel,
  }),
  defineWidget({
    type: 'live-queue',
    title: 'Live-Queue',
    description: 'Die nächsten Songs der Setlist, mit "Als nächstes spielen".',
    category: 'performance',
    stageTier: 'gig',
    defaultLayout: { w: 4, h: 12, minW: 3, minH: 4 },
    parts: [{ id: 'caption', label: 'Überschrift' }, { id: 'numbers', label: 'Nummern' }, { id: 'variant', label: 'Variante' }, { id: 'duration', label: 'Dauer' }],
    configSchema: ContentFontSizeConfigSchema,
    Component: LiveQueueWidget,
    ConfigPanel: ContentFontSizeConfigPanel,
    Preview: LiveQueueWidgetPreview,
  }),
  defineWidget({
    type: 'next-song',
    title: 'Next Song',
    description: 'Aktueller und nächster Song, Vor/Zurück.',
    category: 'performance',
    stageTier: 'gig',
    defaultLayout: { w: 7, h: 3, minW: 4, minH: 3, maxH: 6 },
    parts: [
      { id: 'current', label: 'Aktuell' },
      { id: 'next', label: 'Next' },
    ],
    configSchema: NextSongConfigSchema,
    Component: NextSongWidget,
    ConfigPanel: NextSongConfigPanel,
  }),
  defineWidget({
    type: 'section-jump',
    title: 'Abschnitte',
    description: 'Die Abschnitte des Songs aus der Timeline: der Master springt zum nächsten Ende eines Takts oder Abschnitts oder wiederholt einen Abschnitt - alle Geräte folgen.',
    category: 'performance',
    stageTier: 'gig',
    defaultLayout: { w: 6, h: 4, minW: 3, minH: 3, maxW: 12, maxH: 8 },
    parts: [
      { id: 'when', label: 'Sprung-Zeitpunkt' },
      { id: 'loop', label: 'Wiederholen' },
    ],
    Component: SectionJumpWidget,
    ConfigPanel: SectionJumpConfigPanel,
  }),
  defineWidget({
    type: 'ready-check',
    title: 'Ready-Check',
    description: 'Der Master fragt, ob alle bereit sind, und sieht, wer noch fehlt; alle anderen bestätigen im Hinweis.',
    category: 'performance',
    stageTier: 'gig',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6 },
    parts: [{ id: 'missing', label: 'Wer fehlt' }],
    Component: ReadyCheckWidget,
  }),
  defineWidget({
    type: 'active-setlist',
    title: 'Aktive Setlist',
    description: 'Zeigt, welche Setlist gerade aktiv ist - auch ohne Live-Queue/Next Song.',
    category: 'performance',
    stageTier: 'glance',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6 },
    parts: [{ id: 'caption', label: 'Überschrift' }, { id: 'count', label: 'Anzahl Songs' }],
    configSchema: ActiveSetlistConfigSchema,
    Component: ActiveSetlistWidget,
    ConfigPanel: ActiveSetlistConfigPanel,
  }),
  defineWidget({
    type: 'show-transport',
    title: 'Show-Transport',
    description: 'Play/Pause/Stop/Reset für den aktuellen Song - Gig oder Solo Üben, mit oder ohne Backing-Track-Plugin.',
    category: 'performance',
    stageTier: 'gig',
    defaultLayout: { w: 6, h: 4, minW: 4, minH: 3, maxW: 8, maxH: 6 },
    parts: [
      { id: 'title', label: 'Songtitel' },
      { id: 'time', label: 'Zeit' },
      // Reset = Stop without counting the run as played (a false start) - most bands never need it.
      { id: 'reset', label: 'Reset' },
    ],
    configSchema: ShowTransportConfigSchema,
    Component: ShowTransportWidget,
    ConfigPanel: ShowTransportConfigPanel,
  }),
  defineWidget({
    type: 'visual-metronome',
    title: 'Visueller Metronom',
    description: 'Blitzt im Takt des aktiven Songs (BPM/Taktart), Downbeat farblich abgesetzt.',
    category: 'performance',
    stageTier: 'gig',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6 },
    parts: [{ id: 'info', label: 'Tempo & Takt' }],
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
    stageTier: 'rehearsal',
    defaultLayout: { w: 5, h: 8, minW: 3, minH: 4, maxW: 8, maxH: 12 },
    parts: [{ id: 'caption', label: 'Überschrift' }],
    configSchema: LoopTrainerConfigSchema,
    Component: LoopTrainerWidget,
    ConfigPanel: LoopTrainerConfigPanel,
  }),
  defineWidget({
    type: 'tempo-nudge',
    title: 'Tempo-Korrektur',
    description: 'Live +/- Anpassung des Klick-/Metronom-Tempos, ohne den Song-BPM zu ändern.',
    category: 'performance',
    stageTier: 'gig',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6 },
    parts: [{ id: 'caption', label: 'Überschrift' }],
    configSchema: TempoNudgeConfigSchema,
    Component: TempoNudgeWidget,
    ConfigPanel: TempoNudgeConfigPanel,
  }),
  defineWidget({
    type: 'click-track',
    title: 'Klick',
    description: 'Synthetisierter Klick/Metronom-Ton, an/aus - läuft auf dem als Klick-Ausgabe eingerichteten Gerät.',
    category: 'performance',
    stageTier: 'gig',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6 },
    parts: [{ id: 'caption', label: 'Überschrift' }, { id: 'state', label: 'An/Aus' }],
    configSchema: ClickTrackConfigSchema,
    Component: ClickTrackWidget,
    ConfigPanel: ClickTrackConfigPanel,
  }),
  defineWidget({
    type: 'audio-mix',
    title: 'Mein Mix',
    description: 'Lautstärke von Track, Klick und Ansagen auf diesem Gerät - je ein Regler und Stumm.',
    category: 'performance',
    stageTier: 'gig',
    defaultLayout: { w: 6, h: 8, minW: 3, minH: 5 },
    parts: [{ id: 'hint', label: 'Hinweis' }],
    configSchema: AudioMixConfigSchema,
    Component: AudioMixWidget,
    ConfigPanel: AudioMixConfigPanel,
  }),
  defineWidget({
    type: 'stems',
    title: 'Stems',
    description: 'Solo Üben: die Spuren eines Songs (Schlagzeug, Bass, Gitarre …) statt des Tracks - je ein Regler, Stumm und Solo.',
    category: 'performance',
    stageTier: 'rehearsal',
    defaultLayout: { w: 6, h: 8, minW: 3, minH: 4 },
    parts: [{ id: 'values', label: 'Werte' }],
    configSchema: StemsConfigSchema,
    Component: StemsWidget,
    ConfigPanel: StemsConfigPanel,
  }),
  defineWidget({
    type: 'track-override',
    title: 'Variante & Track',
    description:
      'Wechselt kurzfristig den Backing-Track eines Songs (z.B. "1 Gitarre" statt "keine Gitarre"); in Solo Üben auch die Variante.',
    category: 'performance',
    stageTier: 'gig',
    defaultLayout: { w: 4, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6 },
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
    stageTier: 'gig',
    defaultLayout: { w: 3, h: 2, minW: 2, minH: 2, maxW: 6, maxH: 4 },
    parts: [{ id: 'simulate', label: 'Simulieren' }],
    configSchema: MidiStatusConfigSchema,
    Component: MidiStatusWidget,
    ConfigPanel: MidiStatusConfigPanel,
  }),
  defineWidget({
    type: 'dashboard-switcher',
    title: 'Dashboard-Umschalter',
    description: 'Große Buttons, um zwischen den Dashboards zu wechseln.',
    category: 'performance',
    stageTier: 'gig',
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
    stageTier: 'gig',
    defaultLayout: { w: 6, h: 8, minW: 3, minH: 5 },
    parts: [{ id: 'names', label: 'Kanalnamen' }, { id: 'values', label: 'Werte' }],
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
    stageTier: 'gig',
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
    stageTier: 'gig',
    defaultLayout: { w: 6, h: 8, minW: 3, minH: 4 },
    parts: [{ id: 'last', label: 'Zuletzt' }],
    configSchema: CueGridConfigSchema,
    Component: LightingCuesWidget,
    ConfigPanel: CueGridConfigPanel,
  }),
  defineWidget({
    type: 'system-health',
    title: 'System-Status',
    description: 'Ampel-Übersicht aller Plugin-Capabilities, für Setup/Soundcheck.',
    category: 'system-crew',
    stageTier: 'glance',
    relevantRoles: ['crew'],
    defaultLayout: { w: 4, h: 6, minW: 3, minH: 3 },
    parts: [{ id: 'plugins', label: 'Plugins' }, { id: 'sync', label: 'Uhrzeit-Sync' }],
    configSchema: ContentFontSizeConfigSchema,
    Component: SystemHealthWidget,
    ConfigPanel: ContentFontSizeConfigPanel,
  }),
  defineWidget({
    type: 'sync-check',
    title: 'Sync-Check',
    description: 'Blitzt im Takt der Server-Uhr - zwei Geräte nebeneinander halten und prüfen, ob sie synchron blinken.',
    category: 'system-crew',
    stageTier: 'glance',
    relevantRoles: ['crew'],
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 6 },
    parts: [{ id: 'caption', label: 'Überschrift' }, { id: 'offset', label: 'Offset & Drift' }],
    configSchema: SyncCheckConfigSchema,
    Component: SyncCheckWidget,
    ConfigPanel: SyncCheckConfigPanel,
  }),
  defineWidget({
    type: 'tuner',
    title: 'Stimmgerät',
    description: 'Chromatisches Stimmgerät über das Mikrofon des Tablets.',
    category: 'utility',
    stageTier: 'gig',
    // A tuner that's been squeezed down to something like 4x4 grid units is illegible on
    // stage - there's no useful "small" size for this widget the way there is for, say, a
    // status light. minW/minH are set high enough that even the smallest allowed size
    // still reads at a glance from arm's length.
    defaultLayout: { w: 6, h: 14, minW: 6, minH: 12 },
    parts: [{ id: 'octave', label: 'Oktave' }, { id: 'cents', label: 'Cent & Hz' }],
    configSchema: TunerConfigSchema,
    Component: TunerWidget,
    ConfigPanel: TunerConfigPanel,
    Preview: TunerWidgetPreview,
  }),
  defineWidget({
    type: 'stage-messenger',
    title: 'Stage-Messenger',
    description: 'Kurze Nachricht an alle oder einzelne Musiker blitzen: „Noch 5 Minuten“, „Gitarre stimmen“, eigene Schnellnachrichten.',
    category: 'system-crew',
    stageTier: 'glance',
    defaultLayout: { w: 6, h: 6, minW: 3, minH: 4 },
    configSchema: StageMessengerConfigSchema,
    Component: StageMessengerWidget,
    ConfigPanel: StageMessengerConfigPanel,
  }),
  defineWidget({
    type: 'show-notes',
    title: 'Show-Notizen',
    description: 'Live-Notizen von Band und Crew, zum Nachbericht sichtbar.',
    category: 'system-crew',
    stageTier: 'glance',
    defaultLayout: { w: 4, h: 8, minW: 3, minH: 4 },
    parts: [{ id: 'author', label: 'Autor' }, { id: 'input', label: 'Eingabe' }],
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
    stageTier: 'glance',
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
    stageTier: 'gig',
    defaultLayout: { w: 4, h: 3, minW: 3, minH: 2 },
    parts: [{ id: 'caption', label: 'Überschrift' }, { id: 'target', label: 'Ziel' }, { id: 'estimate', label: 'Schätzung' }],
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
    stageTier: 'gig',
    defaultLayout: { w: 4, h: 3, minW: 2, minH: 2 },
    parts: [{ id: 'seconds', label: 'Sekunden' }],
    configSchema: ClockConfigSchema,
    Component: ClockWidget,
    ConfigPanel: ClockConfigPanel,
  }),
  defineWidget({
    type: 'separator',
    title: 'Trenner',
    description: 'Eine einfache Linie, um Dashboard-Bereiche optisch abzugrenzen.',
    category: 'utility',
    stageTier: 'layout',
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
    stageTier: 'glance',
    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 },
    parts: [{ id: 'name', label: 'Gerätename' }],
    configSchema: DeviceStatusConfigSchema,
    Component: DeviceStatusWidget,
    ConfigPanel: DeviceStatusConfigPanel,
  }),
  defineWidget({
    type: 'custom-trigger',
    title: 'Trigger-Button',
    description: 'Ein Knopf für jede Aktion: Show, Abschnitte, Wiedergabe oder ein Gerätebefehl - tastend, rastend oder zeitgesteuert.',
    category: 'show-control',
    stageTier: 'gig',
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
    stageTier: 'rehearsal',
    defaultLayout: { w: 6, h: 12, minW: 4, minH: 6, maxW: 10, maxH: 16 },
    parts: [{ id: 'notes', label: 'Töne' }, { id: 'intervals', label: 'Intervalle' }, { id: 'guitar', label: 'Griffbild' }, { id: 'piano', label: 'Klaviatur' }],
    configSchema: ChordReferenceConfigSchema,
    Component: ChordReferenceWidget,
    ConfigPanel: ChordReferenceConfigPanel,
  }),
  defineWidget({
    type: 'circle-of-fifths',
    title: 'Quintenzirkel',
    description: 'Tonart antippen: Paralleltonart, Dominante, Subdominante und Vorzeichen auf einen Blick.',
    category: 'reference',
    stageTier: 'rehearsal',
    defaultLayout: { w: 6, h: 10, minW: 4, minH: 7, maxW: 10, maxH: 16 },
    parts: [{ id: 'relations', label: 'Verwandte Tonarten' }, { id: 'signature', label: 'Vorzeichen' }],
    configSchema: CircleOfFifthsConfigSchema,
    Component: CircleOfFifthsWidget,
    ConfigPanel: CircleOfFifthsConfigPanel,
  }),
]

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = Object.fromEntries(
  DEFINITIONS.map((definition) => [definition.type, definition]),
)

export const ALL_WIDGETS: WidgetDefinition[] = DEFINITIONS
