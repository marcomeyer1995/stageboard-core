import type { Dashboard, LogicalDevice } from 'shared-types'
import type { Behavior } from './actions'
import type { KeyBinding } from './keybindings'
import { keyLabel } from './keybindings'
import { describeMidiTrigger, type MidiControllerRulesDoc } from './midiControllerRules'

const pointsTo = (behavior: Behavior | undefined, switchId: string) => behavior?.kind === 'switch' && behavior.switchId === switchId

/**
 * What triggers a switch (docs/23 §11.4): pedal keys on this device (they are per device), MIDI
 * buttons and dashboard buttons of the band - "Pedal B (dieses Gerät), FCB Note 36, Knopf auf
 * Monitoring".
 */
export function switchUsage(
  switchId: string,
  sources: { bindings: readonly KeyBinding[]; midiDocs: readonly MidiControllerRulesDoc[]; devices: readonly LogicalDevice[]; dashboards: readonly Dashboard[] },
): string[] {
  const keys = sources.bindings.filter((b) => pointsTo(b.behavior, switchId)).map((b) => `Taste ${keyLabel(b.key)} (dieses Gerät)`)
  const midi = sources.midiDocs.flatMap((doc) =>
    doc.rules
      .filter((rule) => pointsTo(rule.behavior, switchId))
      .map((rule) => `${sources.devices.find((d) => d.id === doc.id)?.name ?? 'MIDI-Controller'} ${describeMidiTrigger(rule.trigger)}`),
  )
  const buttons = sources.dashboards.flatMap((dashboard) =>
    dashboard.widgets.filter((w) => w.type === 'custom-trigger' && pointsTo((w.config as { action?: Behavior } | undefined)?.action, switchId)).map(() => `Knopf auf „${dashboard.name}“`),
  )
  return [...keys, ...midi, ...buttons]
}
