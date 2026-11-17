import type { PluginInstallation } from 'shared-types'

/**
 * "Aktualisieren" for an installed add-on (#834): the band's installation is a copy of the manifest
 * from the day it was installed. When the catalogue brings a newer version - or the same version
 * with manifest fields the copy lacks (the YouTube add-on before #796 had no `helpers`, so its
 * helper was refused, 2026-11-13) - the admin is offered the update instead of having to remove
 * and re-add it. Later the catalogue comes from repositories (#852, docs/32 §12); this stays the
 * rule for comparing.
 */

type Manifest = Omit<PluginInstallation, 'installedAt' | 'enabled'>

/** Numeric dot-version compare ("1.10.0" > "1.9.2"); a missing part counts 0, text after a dash
 * (a pre-release) is ignored. -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, '').split('-')[0]!.split('.').map((p) => Number.parseInt(p, 10) || 0)
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

/** The manifest fields that decide what an add-on is and may do - not the band's own state
 * (enabled, settings, installedAt). */
const MANIFEST_KEYS = ['name', 'source', 'clientSource', 'runtime', 'capabilities', 'transports', 'hardwareIds', 'discoveryTrigger', 'timing', 'apiVersion', 'permissions', 'helpers'] as const

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

export interface AddonUpdate {
  from: string
  to: string
  /** Permissions the new manifest asks for that the installed one doesn't have - the admin confirms these. */
  newPermissions: string[]
}

/** The update the catalogue offers for this installation, or null. Never a downgrade. */
export function availableUpdate(installed: PluginInstallation, entry: Manifest | undefined): AddonUpdate | null {
  if (!entry || entry.id !== installed.id) return null
  const order = compareVersions(entry.version, installed.version)
  if (order < 0) return null
  if (order === 0 && MANIFEST_KEYS.every((key) => same(installed[key], entry[key]))) return null
  const had = new Set(installed.permissions ?? [])
  return { from: installed.version, to: entry.version, newPermissions: (entry.permissions ?? []).filter((p) => !had.has(p)) }
}

/** The installation after the update: the catalogue's manifest, the band's own state kept. */
export function updatedInstallation(installed: PluginInstallation, entry: Manifest): PluginInstallation {
  return {
    ...entry,
    enabled: installed.enabled,
    installedAt: installed.installedAt,
    ...(installed.settings !== undefined ? { settings: installed.settings } : {}),
  }
}
