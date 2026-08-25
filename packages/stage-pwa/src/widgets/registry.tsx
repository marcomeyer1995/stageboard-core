import type { ComponentType } from 'react'
import { z } from 'zod'
import { CAPABILITIES, type CapabilityId } from 'shared-types'
import { ClockControlWidget } from './ClockControlWidget'
import { DashboardSwitcherConfigPanel, DashboardSwitcherView } from './DashboardSwitcherWidget'
import { DashboardSwitcherConfigSchema } from './dashboardSwitcherConfig'
import { IemWidget } from './IemWidget'
import { MidiStatusWidget } from './MidiStatusWidget'
import { NextSongWidget } from './NextSongWidget'
import { PrompterWidget } from './PrompterWidget'
import { QuickActionsWidget } from './QuickActionsWidget'

export interface WidgetSize {
  w: number
  h: number
  minW?: number
  minH?: number
}

/** A widget as the dashboard grid sees it: config already parsed, type parameter erased. */
export interface WidgetDefinition {
  type: string
  title: string
  description: string
  /** Capabilities this widget needs. Empty means core - it can never grey out. */
  requires: CapabilityId[]
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
    defaultLayout: { w: 12, h: 16, minW: 3, minH: 6 },
    Component: PrompterWidget,
  }),
  defineWidget({
    type: 'next-song',
    title: 'Next Song',
    description: 'Aktueller und nächster Song, Master-Token, "Nächster Song".',
    defaultLayout: { w: 7, h: 2, minW: 3, minH: 2 },
    Component: NextSongWidget,
  }),
  defineWidget({
    type: 'clock',
    title: 'Show Cockpit',
    description: 'Master-Clock mit Start/Stop und Reset.',
    defaultLayout: { w: 3, h: 2, minW: 2, minH: 2 },
    Component: ClockControlWidget,
  }),
  defineWidget({
    type: 'midi-status',
    title: 'Fußtaster',
    description: 'Status des MIDI-Fußtasters, Sprung zum nächsten Song-Part.',
    requires: [CAPABILITIES.midiInput],
    defaultLayout: { w: 3, h: 2, minW: 2, minH: 2 },
    Component: MidiStatusWidget,
  }),
  defineWidget({
    type: 'dashboard-switcher',
    title: 'Dashboard-Umschalter',
    description: 'Große Buttons, um zwischen den Dashboards zu wechseln.',
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
    defaultLayout: { w: 6, h: 8, minW: 3, minH: 5 },
    Component: IemWidget,
  }),
  defineWidget({
    type: 'quick-actions',
    title: 'Quick Actions',
    description: 'Große Buttons für Ad-Hoc Show Cues.',
    requires: [CAPABILITIES.showControl],
    defaultLayout: { w: 6, h: 8, minW: 3, minH: 4 },
    Component: QuickActionsWidget,
  }),
]

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = Object.fromEntries(
  DEFINITIONS.map((definition) => [definition.type, definition]),
)

export const ALL_WIDGETS: WidgetDefinition[] = DEFINITIONS
