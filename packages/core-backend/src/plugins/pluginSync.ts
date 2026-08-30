import { HEALTH_TIMEOUT_MS, PluginInstallationSchema, type PluginInstallation } from 'shared-types'
import { allDocs, ensureDb, waitForChange, type CouchConfig } from '../couch.js'
import { PLUGIN_CATALOG } from './catalog.js'
import * as healthStore from './healthStore.js'
import type { PluginRegistry } from './registry.js'

/** Comfortably inside HEALTH_TIMEOUT_MS, so a healthy server never looks stale. */
const HEARTBEAT_INTERVAL_MS = Math.floor(HEALTH_TIMEOUT_MS / 3)
const CHANGES_TIMEOUT_MS = 30_000

export interface PluginSyncOptions {
  couch: CouchConfig
  workspaceId: string
  registry: PluginRegistry
  log: { info: (msg: string, meta?: Record<string, unknown>) => void
         error: (msg: string, meta?: Record<string, unknown>) => void }
}

export interface PluginSyncHandle {
  stop: () => void
  /** Exposed for tests and for an immediate pass at startup. */
  syncOnce: () => Promise<void>
  writeHeartbeat: () => Promise<void>
}

function pluginsDbName(workspaceId: string): string {
  return `stageboard-plugins-${workspaceId}`
}

/** Only documents that parse are trusted - a half-replicated doc must not crash the server. */
export function readInstallations(docs: unknown[]): PluginInstallation[] {
  const installations: PluginInstallation[] = []
  for (const doc of docs) {
    const parsed = PluginInstallationSchema.safeParse(doc)
    if (parsed.success) installations.push(parsed.data)
  }
  return installations
}

/**
 * Decides which plugins to start and stop, given what the band installed, what is already
 * running, and what this server build can actually construct. Pure, so the interesting
 * part of the sync needs no CouchDB to test.
 */
export function reconcile(
  installations: PluginInstallation[],
  registered: string[],
  catalog: string[],
): { toRegister: string[]; toUnregister: string[]; unavailable: string[] } {
  const wanted = new Set<string>()
  const unavailable: string[] = []

  for (const installation of installations) {
    // Client-side plugins (WebMIDI) run on the tablet; the server has nothing to start.
    if (!installation.enabled || installation.runtime === 'client') continue
    if (!catalog.includes(installation.id)) {
      unavailable.push(installation.id)
      continue
    }
    wanted.add(installation.id)
  }

  return {
    toRegister: [...wanted].filter((id) => !registered.includes(id)),
    toUnregister: registered.filter((id) => !wanted.has(id)),
    unavailable,
  }
}

/**
 * Reconciles the plugins the band installed (replicated to us over the stage mesh) with the
 * plugins actually running in this server's registry, and writes a heartbeat into
 * healthStore.ts so every tablet can tell "installed" from "reachable right now" (docs/07) -
 * pushed out over `GET /plugin-health/:workspaceId/stream` (index.ts), not CouchDB sync
 * (see #49 follow-up: a heartbeat has no offline/multi-master value).
 */
export function createPluginSync(options: PluginSyncOptions): PluginSyncHandle {
  const { couch, workspaceId, registry, log } = options
  const pluginsDb = pluginsDbName(workspaceId)
  let stopped = false

  const pluginContext = { log }

  async function syncOnce(): Promise<void> {
    const installations = readInstallations(await allDocs<unknown>(couch, pluginsDb))
    const { toRegister, toUnregister, unavailable } = reconcile(
      installations,
      registry.list().map(({ name }) => name),
      Object.keys(PLUGIN_CATALOG),
    )

    for (const id of unavailable) {
      log.info('Ignoring installed plugin with no implementation on this server', { plugin: id })
    }
    for (const id of toRegister) {
      await registry.register(PLUGIN_CATALOG[id](), pluginContext)
      log.info('Registered plugin from replicated installation', { plugin: id })
    }
    for (const id of toUnregister) {
      await registry.unregister(id)
      log.info('Unregistered plugin - disabled or uninstalled', { plugin: id })
    }
  }

  async function writeHeartbeat(): Promise<void> {
    const now = Date.now()
    for (const { name } of registry.list()) {
      healthStore.setEntry(workspaceId, name, { status: 'online', lastSeenAt: now })
    }
  }

  async function watchChanges(): Promise<void> {
    let since = 'now'
    while (!stopped) {
      try {
        const { lastSeq, changed } = await waitForChange(couch, pluginsDb, since, CHANGES_TIMEOUT_MS)
        since = lastSeq
        if (changed && !stopped) await syncOnce()
      } catch (err) {
        // CouchDB restarting or unreachable: back off, then keep watching.
        log.error('Plugin changes feed failed, retrying', { error: String(err) })
        await new Promise((resolve) => setTimeout(resolve, 5_000))
      }
    }
  }

  const heartbeat = setInterval(() => {
    writeHeartbeat().catch((err) => log.error('Heartbeat failed', { error: String(err) }))
  }, HEARTBEAT_INTERVAL_MS)

  async function start(): Promise<void> {
    await ensureDb(couch, pluginsDb)
    await syncOnce()
    await writeHeartbeat()
    void watchChanges()
  }

  start().catch((err) => log.error('Plugin sync failed to start', { error: String(err) }))

  return {
    stop: () => {
      stopped = true
      clearInterval(heartbeat)
    },
    syncOnce,
    writeHeartbeat,
  }
}
