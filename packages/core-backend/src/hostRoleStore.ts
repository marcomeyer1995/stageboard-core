import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * What a host remembers of its role (host backup, #920): the epoch it serves under and whether it is
 * the active host. A backup that took over must still be the host after a restart - and under the
 * same epoch, or two hosts would announce different ones. A plain file on this box's own disk, not a
 * database document: it describes this one host, not the band's data (like active-workspace.json).
 */
export interface HostRole {
  epoch: number
  active: boolean
}

export interface HostRoleStore {
  load(): HostRole
  save(role: HostRole): void
}

const START: HostRole = { epoch: 0, active: false }

export function createHostRoleStore(stateDir: string): HostRoleStore {
  const file = join(stateDir, 'host-role.json')
  return {
    load() {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<HostRole>
        return Number.isInteger(parsed.epoch) && (parsed.epoch as number) >= 0 && typeof parsed.active === 'boolean'
          ? { epoch: parsed.epoch as number, active: parsed.active }
          : START
      } catch {
        return START
      }
    },
    save(role) {
      try {
        mkdirSync(stateDir, { recursive: true })
        writeFileSync(file, JSON.stringify(role))
      } catch (err) {
        console.error(`Could not save the host role to ${file}:`, err)
      }
    },
  }
}
