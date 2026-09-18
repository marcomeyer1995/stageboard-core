import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Which workspace this specific physical Stage-Server's hardware (plugin sync, Discovery
 * Mode's MIDI watcher) currently serves - a plain local JSON file on this box's own disk, not
 * a CouchDB doc. Unlike every other piece of state in core-backend, this is deliberately never
 * multi-master replicated: it describes this one box, not the band's data.
 *
 * Read fresh on every call, not cached at module scope - tests point this at a fresh temp dir
 * per run by setting the env var before calling into this module (same convention as
 * audioStore.ts's audioStorageDir()).
 */
function stateDir(): string {
  return process.env.STAGEBOARD_STATE_DIR ?? './data'
}

function stateFilePath(): string {
  return join(stateDir(), 'active-workspace.json')
}

/** `null` if no workspace has ever been activated on this box yet, or if the file is missing,
 * unreadable, or malformed - this must never throw and never block boot. */
export function readPersistedActiveWorkspace(): string | null {
  const path = stateFilePath()
  if (!existsSync(path)) return null

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'workspaceId' in parsed &&
      typeof (parsed as { workspaceId: unknown }).workspaceId === 'string'
    ) {
      return (parsed as { workspaceId: string }).workspaceId
    }
    console.error(`Malformed active-workspace state file at ${path} - ignoring`)
    return null
  } catch (err) {
    console.error(`Failed to read active-workspace state file at ${path}`, err)
    return null
  }
}

export function writePersistedActiveWorkspace(workspaceId: string): void {
  mkdirSync(stateDir(), { recursive: true })
  writeFileSync(stateFilePath(), JSON.stringify({ workspaceId }))
}
