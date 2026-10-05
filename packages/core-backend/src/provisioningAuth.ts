import { randomInt } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Who may provision a new band on this Stage-Server (#364). `POST /workspaces` used to hand out an
 * admin account to anyone on the LAN. Now one of these proofs is needed:
 * - the request comes from the Stage-Server machine itself (physical presence),
 * - the caller is an admin of another band on this server (the app sends that automatically),
 * - the caller knows the current founding code ("Gründungs-Code"): shown to band admins in the
 *   app and on the server itself; it changes after every use and on every restart.
 * Ids of deleted bands can't be provisioned again this way - restoring a deleted band goes
 * through the documented CouchDB recovery (docs/03 §0b).
 */

/** 8 digits, like the band access code. */
function newCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, '0')
}

export interface SetupCode {
  current: () => string
  /** Constant-time-ish comparison; a successful use rotates the code. */
  consume: (code: string) => boolean
}

export function createSetupCode(): SetupCode {
  let code = newCode()
  return {
    current: () => code,
    consume: (candidate) => {
      if (candidate.length !== code.length) return false
      let diff = 0
      for (let i = 0; i < code.length; i++) diff |= candidate.charCodeAt(i) ^ code.charCodeAt(i)
      if (diff !== 0) return false
      code = newCode()
      return true
    },
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function isLoopback(ip: string): boolean {
  return LOOPBACK.has(ip)
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
