export type Mode = 'live' | 'library' | 'system'

/**
 * All always available - no capability gating at this level anymore. Plugins, Backup, and
 * Nachbericht used to be top-level modes here too, each individually capability-gated; they're
 * now tabs inside SystemView.tsx (see #20's original "Live / Bibliothek / System" three-pillar
 * plan, finally finished in the 2026-08-30 menu-decluttering pass), and SystemView does its
 * own gating per tab (only Backup needs it) instead of this module hiding a whole top-level
 * mode.
 */
export const MODES: Mode[] = ['live', 'library', 'system']

export const MODE_LABEL: Record<Mode, string> = {
  live: 'Live',
  library: 'Bibliothek',
  system: 'System',
}
