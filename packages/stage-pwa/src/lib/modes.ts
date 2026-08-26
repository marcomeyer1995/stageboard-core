import { CAPABILITIES, type CapabilityId } from 'shared-types'
import { capabilityStatusFor, type CapabilityStatus } from './capabilities'

export type Mode = 'live' | 'edit' | 'setlists' | 'plugins' | 'backup' | 'post-show'

export const MODES: Mode[] = ['live', 'edit', 'setlists', 'plugins', 'backup', 'post-show']

export const MODE_LABEL: Record<Mode, string> = {
  live: 'Live',
  edit: 'Songs',
  setlists: 'Setlists',
  plugins: 'Plugins',
  backup: 'Backup',
  'post-show': 'Nachbericht',
}

/**
 * Capabilities a mode needs to even appear in the menu - mirrors WidgetDefinition.requires.
 * Unset means core, same as an empty `requires` array. Backup is an offline/administrative
 * concern (not on-stage during a show), so unlike a widget it lives as its own full screen
 * rather than a dashboard grid entry - but the same capability-gating keeps it out of the
 * way entirely for a band with no backup plugin installed, instead of an always-visible
 * empty screen.
 */
const MODE_REQUIRES: Partial<Record<Mode, CapabilityId[]>> = {
  backup: [CAPABILITIES.backup],
}

/** Roles a mode is relevant to - mirrors WidgetDefinition.relevantRoles. Unset means everyone. */
const MODE_RELEVANT_ROLES: Partial<Record<Mode, string[]>> = {}

/** Which modes to actually offer, given the band's plugins and the active profile's role. */
export function availableModes(
  capabilities: Map<CapabilityId, CapabilityStatus>,
  activeRole?: string,
): Mode[] {
  return MODES.filter((mode) => {
    if (capabilityStatusFor(MODE_REQUIRES[mode] ?? [], capabilities) === 'missing') return false
    const relevantRoles = MODE_RELEVANT_ROLES[mode]
    if (relevantRoles && !relevantRoles.includes(activeRole ?? '')) return false
    return true
  })
}
