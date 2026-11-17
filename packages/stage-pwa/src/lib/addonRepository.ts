import type { AddonReleaseManifest, AddonSource, PluginInstallation } from 'shared-types'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { getStageServerUrl } from './stageServer'
import { createWorkspaceCollection } from './workspaceCollection'

/**
 * "Aus Repository installieren" (docs/32 §12 step 3, #852): the admin's device asks the host what a
 * repository offers, shows it, and after "Installieren" lets the host download and check it; then
 * it writes the band's documents - the installation (its client bundle from the host's copy) and
 * the add-on source.
 */

/** What the host's preview answers (core-backend addonStore.ts `AddonPreview`). */
export interface RepositoryAddonPreview {
  repository: string
  publisher: string
  release: string
  downloadBytes: number
  manifest: AddonReleaseManifest
}

/** Publishers whose add-ons need no warning: StageBoard's own. The suggestion list (docs/32 §12a)
 * will add the confirmed ones. */
export const KNOWN_PUBLISHERS: readonly string[] = ['marcomeyer1995']

export function isKnownPublisher(publisher: string, confirmed = false): boolean {
  return confirmed || KNOWN_PUBLISHERS.some((known) => known.toLowerCase() === publisher.toLowerCase())
}

/** A failure the admin can read - the host's error code, or `offline` without a host. */
export class RepositoryAddonError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const sources = createWorkspaceCollection<AddonSource>('addon-sources')

async function callHost<T>(workspaceId: string, action: 'preview' | 'install', body: object): Promise<T> {
  const base = getStageServerUrl()
  const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  if (!base || !workspace?.username || !workspace.couchPassword) throw new RepositoryAddonError('offline')
  let response: Response
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/workspaces/${encodeURIComponent(workspaceId)}/addons/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${workspace.username}:${workspace.couchPassword}`)}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(action === 'install' ? 180_000 : 30_000),
    })
  } catch {
    throw new RepositoryAddonError('offline')
  }
  if (response.status === 403) throw new RepositoryAddonError('not-admin')
  if (!response.ok) {
    const answer = (await response.json().catch(() => ({}))) as { code?: string }
    throw new RepositoryAddonError(answer.code ?? `http-${response.status}`)
  }
  return (await response.json()) as T
}

export function previewRepositoryAddon(workspaceId: string, repository: string): Promise<RepositoryAddonPreview> {
  return callHost<RepositoryAddonPreview>(workspaceId, 'preview', { repository })
}

/** The band's installation from a release manifest: the manifest's fields, the client bundle from
 * the host's checked copy, and - on an update - the band's own state kept. */
export function installationFromManifest(manifest: AddonReleaseManifest, existing: PluginInstallation | undefined, now: number): PluginInstallation {
  // Only what a release has, not a band's installation.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { files, clientFile, serverFile, changes, minStageBoard, ...fields } = manifest
  return {
    ...fields,
    ...(clientFile ? { clientSource: `/addons/${manifest.id}/${manifest.version}/${clientFile}` } : {}),
    ...(serverFile ? { source: `/addons/${manifest.id}/${manifest.version}/${serverFile}` } : {}),
    enabled: existing?.enabled ?? true,
    installedAt: existing?.installedAt ?? now,
    ...(existing?.settings !== undefined ? { settings: existing.settings } : {}),
  }
}

/** Lets the host download and check the version the admin saw, then writes the band's documents. */
export async function installRepositoryAddon(
  workspaceId: string,
  preview: RepositoryAddonPreview,
  existing: PluginInstallation | undefined,
  publisherConfirmed: boolean,
  putPlugin: (installation: PluginInstallation) => Promise<void>,
): Promise<PluginInstallation> {
  const previousVersion = existing && existing.version !== preview.manifest.version ? existing.version : undefined
  const answer = await callHost<{ keptVersions: string[] }>(workspaceId, 'install', {
    repository: preview.repository,
    expectedVersion: preview.manifest.version,
    ...(previousVersion ? { previousVersion } : {}),
  })
  const installation = installationFromManifest(preview.manifest, existing, Date.now())
  await putPlugin(installation)
  sources.switchWorkspace(workspaceId)
  await sources.put({
    id: preview.manifest.id,
    repository: preview.repository,
    installedVersion: preview.manifest.version,
    keptVersions: answer.keptVersions,
    lastCheckedAt: Date.now(),
    latestVersion: preview.manifest.version,
    publisherConfirmed: publisherConfirmed || isKnownPublisher(preview.publisher),
  })
  return installation
}

/** A permission in words (docs/32 §7) - what the admin agrees to before installing. */
export function permissionLabel(permission: string, t: (key: string, values?: Record<string, string>) => string): string {
  const [kind, ...rest] = permission.split(':')
  const target = rest.join(':')
  switch (kind) {
    case 'midi-out':
      return t('repo.perm.midiOut', { target })
    case 'midi-in':
      return t('repo.perm.midiIn', { target })
    case 'osc':
      return t('repo.perm.osc', { target })
    case 'http':
      return t('repo.perm.http', { target })
    case 'helper':
      return t('repo.perm.helper', { target })
    case 'audio-store':
      return t('repo.perm.audioStore')
    case 'songs':
      return target === 'write' ? t('repo.perm.songsWrite') : t('repo.perm.songsRead')
    default:
      return permission
  }
}
