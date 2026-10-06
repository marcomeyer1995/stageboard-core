/**
 * Server-local command to delete a band (#70 break-glass, first piece). Deleting through the
 * app needs that band's admin login - useless for leftovers nobody can log into any more (test
 * bands from development). This runs on the Stage-Server itself, with the server's own CouchDB
 * configuration, and never prints any credential.
 *
 *   npm run band:delete -w core-backend                                 # list bands
 *   npm run band:delete -w core-backend -- <band-id> --confirm "<name>" # delete one
 *
 * Guards: the exact band name has to be typed (like "Band für alle löschen" in the app), and the
 * band whose hardware the server currently serves can't be deleted. CouchDB keeps deleted
 * databases recoverable (docs/03 §0b).
 */
import { pathToFileURL } from 'node:url'
import { serverCouchConfig } from './serviceEnv.js'

export interface Band {
  workspaceId: string
  workspaceName: string
}

export type Plan =
  | { kind: 'list' }
  | { kind: 'delete'; band: Band }
  | { kind: 'error'; message: string }

/** Pure decision: what the given arguments ask for, and whether it is allowed. */
export function planDeletion(args: string[], bands: Band[], activeWorkspaceId: string | null): Plan {
  const positional = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--confirm')
  if (positional.length === 0) return { kind: 'list' }
  const id = positional[0]
  const band = bands.find((b) => b.workspaceId === id)
  if (!band) return { kind: 'error', message: `Keine Band mit der ID ${id} auf diesem Stage-Server.` }
  if (band.workspaceId === activeWorkspaceId) {
    return {
      kind: 'error',
      message: `"${band.workspaceName}" ist die aktive Band dieses Stage-Servers und wird nicht gelöscht. Erst in der App eine andere Band aktivieren.`,
    }
  }
  const confirmIndex = args.indexOf('--confirm')
  const typed = confirmIndex >= 0 ? args[confirmIndex + 1] : undefined
  if (typed !== band.workspaceName) {
    return {
      kind: 'error',
      message: `Zur Bestätigung den genauen Namen angeben: --confirm "${band.workspaceName}"`,
    }
  }
  return { kind: 'delete', band }
}

async function main(): Promise<void> {
  const couch = serverCouchConfig()
  // Imported after the environment is set, like the server itself.
  const { listWorkspaces, deprovisionWorkspace } = await import('../workspaceProvisioning.js')
  const { readPersistedActiveWorkspace } = await import('../activeWorkspaceStateStore.js')

  const bands = await listWorkspaces(couch)
  const active = readPersistedActiveWorkspace()
  const plan = planDeletion(process.argv.slice(2), bands, active)

  if (plan.kind === 'list') {
    console.log('Bands auf diesem Stage-Server:')
    for (const band of bands) {
      console.log(`  ${band.workspaceId}  ${band.workspaceName}${band.workspaceId === active ? '  (aktiv)' : ''}`)
    }
    console.log('\nLöschen: npm run band:delete -w core-backend -- <ID> --confirm "<Name>"')
    return
  }
  if (plan.kind === 'error') {
    console.error(plan.message)
    process.exitCode = 1
    return
  }
  await deprovisionWorkspace(couch, plan.band.workspaceId)
  console.log(`Gelöscht: "${plan.band.workspaceName}" (${plan.band.workspaceId}).`)
  console.log('CouchDB hält die Datenbank wiederherstellbar - Ablauf in docs/03 §0b.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(`Fehler: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
