import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'

/**
 * Who may provision a new band on this Stage-Server (#364). `POST /workspaces` used to hand out an
 * admin account to anyone on the LAN. Now (Marco, 2026-10-05):
 * - the first band on a fresh server: anyone (setting the server up),
 * - every further band: an admin of a band on this server (the app sends that login
 *   automatically) - or a request from the Stage-Server machine itself (emergency exit).
 * Ids of deleted bands can't be provisioned again this way - restoring a deleted band goes
 * through the documented CouchDB recovery (docs/03 §0b).
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** The machine's own addresses, IPv4 also in its IPv6-mapped form. */
function ownAddresses(): Set<string> {
  const own = new Set<string>()
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      own.add(entry.address)
      if (entry.family === 'IPv4') own.add(`::ffff:${entry.address}`)
    }
  }
  return own
}

/** Whether a request comes from the Stage-Server machine itself: loopback, or one of its own
 * interface addresses - a browser on the server laptop that opens the server by its LAN IP
 * (https://192.168.178.x) arrives with that address, not 127.0.0.1. A TCP connection can't
 * fake its source address on the LAN, and `trustProxy` is off, so `request.ip` is the socket's. */
export function isLoopback(ip: string, own: Set<string> = ownAddresses()): boolean {
  return LOOPBACK.has(ip) || own.has(ip)
}

function deletedFile(): string {
  return join(process.env.STAGEBOARD_STATE_DIR ?? './data', 'deleted-workspaces.json')
}

/** Ids of bands deleted on this server (read fresh; a missing/broken file means none). */
export function readDeletedWorkspaces(): string[] {
  const path = deletedFile()
  if (!existsSync(path)) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function recordDeletedWorkspace(workspaceId: string): void {
  const ids = readDeletedWorkspaces()
  if (ids.includes(workspaceId)) return
  const path = deletedFile()
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify([...ids, workspaceId], null, 2))
}
