import type { CouchConfig } from './couch.js'
import { createMidiWatcher, type MidiWatcherHandle } from './midiWatcher.js'
import { createPluginSync, type PluginSyncHandle } from './plugins/pluginSync.js'
import type { PluginRegistry } from './plugins/registry.js'
import { writePersistedActiveWorkspace } from './activeWorkspaceStateStore.js'

export interface WorkspaceHardwareControllerOptions {
  couch: CouchConfig
  registry: PluginRegistry
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void
    error: (msg: string, meta?: Record<string, unknown>) => void
  }
}

export interface WorkspaceHardwareController {
  /** Activates this box's hardware for `workspaceId` - always deactivates whichever workspace
   * was previously active first, so exactly one workspace's hardware ever runs at a time. */
  activate: (workspaceId: string) => Promise<void>
  /** Stops the currently active workspace's hardware, if any. Safe to call when nothing is
   * active. */
  deactivate: () => Promise<void>
  getActiveWorkspaceId: () => string | null
}

/**
 * The single owner of this box's "which workspace's hardware is currently live" state -
 * replaces the old inline, boot-only `if (process.env.STAGEBOARD_WORKSPACE)` block in
 * main() (2026-09-02 phantom-"band-a" fix) with something callable again while the process
 * keeps running, for the real-world case of one physical Stage-Server serving two of Marco's
 * own bands on different days, never at the same time.
 */
export function createWorkspaceHardwareController(
  options: WorkspaceHardwareControllerOptions,
): WorkspaceHardwareController {
  const { couch, registry, log } = options

  let current: { workspaceId: string; sync: PluginSyncHandle; midiWatcher: MidiWatcherHandle } | null = null

  async function deactivate(): Promise<void> {
    if (!current) return

    // sync.stop() (pluginSync.ts) only clears its own heartbeat interval - it never
    // unregisters anything, so without this loop the previous workspace's plugins would stay
    // registered (and visible in GET /plugins) forever after a switch.
    for (const { name } of registry.list()) {
      await registry.unregister(name)
    }

    current.sync.stop()
    current.midiWatcher.stop()
    log.info('Deactivated workspace hardware', { workspaceId: current.workspaceId })
    current = null
  }

  async function activate(workspaceId: string): Promise<void> {
    await deactivate()

    const sync = createPluginSync({ couch, workspaceId, registry, log })
    const midiWatcher = createMidiWatcher({ couch, workspaceId, log })
    current = { workspaceId, sync, midiWatcher }

    writePersistedActiveWorkspace(workspaceId)
    log.info('Activated workspace hardware', { workspaceId })
  }

  return {
    activate,
    deactivate,
    getActiveWorkspaceId: () => current?.workspaceId ?? null,
  }
}
