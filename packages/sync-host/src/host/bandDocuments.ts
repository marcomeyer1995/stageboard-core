import type { MasterMode } from 'shared-types'
import type { BandStore } from './bandCatalog.js'
import { ROSTER_VALIDATOR_SOURCE } from './rosterValidator.js'

/**
 * The documents of a band a host writes itself (#964, step 1): the access doc (standing code, name, master mode, the founding
 * host) and the Device Ledger's block and cleanup. The rules, once, for every host - the laptop and the tablet only say how a
 * document of a band is read and written (`BandDocumentPort`). Until now each host had its own copy, and they differed: the
 * laptop rewrote the access doc from three fields and dropped the founding tablet's `hostId` on a rename.
 */

/** A document of a band as stored (CouchDB-shaped). */
export type BandDocument = Record<string, unknown> & { _id: string; _rev?: string; _deleted?: boolean }

/** How a host reads and writes the documents of one band. */
export interface BandDocumentPort {
  get(id: string): Promise<BandDocument | null>
  /**
   * Read, change, write - read again and change again when another write came first. `change` gets the stored document (or null)
   * and returns the document to write (`_deleted: true` deletes it), or undefined to write nothing.
   */
  update(id: string, change: (existing: BandDocument | null) => BandDocument | undefined): Promise<void>
  /** Every document whose id starts with `prefix`. */
  list(prefix: string): Promise<BandDocument[]>
}

export const ACCESS_DOC_ID = 'workspace:access'
export const RULES_DOC_ID = '_design/roster'
const DEVICE_PREFIX = 'devices:'

/** 8 digits, zero-padded - the "WiFi password" a band writes down once; its protection is that only the band's own network hands it out. */
export function generateAccessCode(): string {
  const value = new Uint32Array(1)
  crypto.getRandomValues(value)
  return (value[0]! % 100_000_000).toString().padStart(8, '0')
}

/** The access doc with what changes - every other field kept (the founding host, a field a newer app version added). */
function accessDoc(existing: BandDocument | null, change: { code?: string; name?: string; masterMode?: MasterMode }, fallbackName: string, newCode: () => string): BandDocument {
  const code = change.code ?? (typeof existing?.code === 'string' ? existing.code : newCode())
  const name = change.name ?? (typeof existing?.name === 'string' ? existing.name : fallbackName)
  const doc: BandDocument = { ...(existing ?? {}), _id: ACCESS_DOC_ID, code, name }
  if (change.masterMode) doc.masterMode = change.masterMode
  return doc
}

export type BandDocuments = Pick<BandStore, 'accessCode' | 'ensureAccessCode' | 'rotateAccessCode' | 'rename' | 'setMasterMode' | 'setDeviceRevoked' | 'forgetDevice'> & {
  /** The access doc of a band just founded (on the host that founds it, with that host's id). */
  createAccess(workspaceId: string, name: string, hostId?: string): Promise<string>
  /** The write rules of a band just founded (`_design/roster`: only an admin changes the roster, ...). */
  writeRules(workspaceId: string): Promise<void>
  /**
   * Brings the write rules of a band up to this version (they used to be written at founding only, so a band founded before a rule
   * was added never got it, #16). A band without rules is left as it is. True when they were replaced.
   */
  updateRules(workspaceId: string): Promise<boolean>
}

export interface BandDocumentsOptions {
  /** The documents of one band. */
  open: (workspaceId: string) => BandDocumentPort
  newCode?: () => string
}

export function createBandDocuments(options: BandDocumentsOptions): BandDocuments {
  const newCode = options.newCode ?? generateAccessCode
  const readAccess = async (workspaceId: string) => {
    const doc = await options.open(workspaceId).get(ACCESS_DOC_ID)
    return doc && typeof doc.code === 'string' && typeof doc.name === 'string' ? { code: doc.code, name: doc.name } : null
  }

  return {
    async createAccess(workspaceId, name, hostId) {
      const code = newCode()
      await options.open(workspaceId).update(ACCESS_DOC_ID, (existing) => ({ ...accessDoc(existing, { code, name }, name, newCode), ...(hostId ? { hostId } : {}) }))
      return code
    },
    async writeRules(workspaceId) {
      await options.open(workspaceId).update(RULES_DOC_ID, (existing) => ({ ...(existing ?? {}), _id: RULES_DOC_ID, validate_doc_update: ROSTER_VALIDATOR_SOURCE }))
    },
    async updateRules(workspaceId) {
      let replaced = false
      await options.open(workspaceId).update(RULES_DOC_ID, (existing) => {
        replaced = false
        if (!existing || existing.validate_doc_update === ROSTER_VALIDATOR_SOURCE) return undefined
        replaced = true
        return { ...existing, validate_doc_update: ROSTER_VALIDATOR_SOURCE }
      })
      return replaced
    },
    accessCode: readAccess,
    async ensureAccessCode(workspaceId, fallbackName) {
      const existing = await readAccess(workspaceId)
      if (existing) return existing
      // A band founded before the standing code (2026-09-01) gets one on its first request - no migration step.
      let made: { code: string; name: string } | null = null
      await options.open(workspaceId).update(ACCESS_DOC_ID, (current) => {
        if (current && typeof current.code === 'string' && typeof current.name === 'string') {
          made = { code: current.code, name: current.name }
          return undefined
        }
        const doc = accessDoc(current, { code: newCode(), name: fallbackName }, fallbackName, newCode)
        made = { code: doc.code as string, name: doc.name as string }
        return doc
      })
      return made ?? (await readAccess(workspaceId)) ?? { code: '', name: fallbackName }
    },
    async rotateAccessCode(workspaceId) {
      const code = newCode()
      await options.open(workspaceId).update(ACCESS_DOC_ID, (existing) => accessDoc(existing, { code }, workspaceId, newCode))
      return code
    },
    async rename(workspaceId, name) {
      await options.open(workspaceId).update(ACCESS_DOC_ID, (existing) => accessDoc(existing, { name }, workspaceId, newCode))
    },
    async setMasterMode(workspaceId, masterMode) {
      await options.open(workspaceId).update(ACCESS_DOC_ID, (existing) => accessDoc(existing, { masterMode }, workspaceId, newCode))
    },

    async setDeviceRevoked(workspaceId, deviceId, revoked) {
      let outcome: 'ok' | 'unknown' = 'ok'
      await options.open(workspaceId).update(`${DEVICE_PREFIX}${deviceId}`, (existing) => {
        if (!existing) {
          outcome = 'unknown'
          return undefined
        }
        outcome = 'ok'
        return { ...existing, revoked }
      })
      return outcome
    },

    async forgetDevice(workspaceId, deviceId) {
      const band = options.open(workspaceId)
      const id = `${DEVICE_PREFIX}${deviceId}`
      const device = await band.get(id)
      if (!device) return 'unknown'
      if (device.revoked) return 'blocked'
      // A device a hardware device runs on stays: removing it would leave the hardware without a place to run.
      const usedBy = (await band.list('logical-devices:')).filter((doc) => doc.executionTarget === deviceId).map((doc) => (typeof doc.name === 'string' ? doc.name : doc._id))
      if (usedBy.length > 0) return { usedBy }
      // Checked and deleted against the same revision: a block in between is seen, never deleted over.
      let outcome: 'ok' | 'unknown' | 'blocked' = 'ok'
      await band.update(id, (current) => {
        if (!current) {
          outcome = 'unknown'
          return undefined
        }
        if (current.revoked) {
          outcome = 'blocked'
          return undefined
        }
        outcome = 'ok'
        return { _id: id, ...(current._rev ? { _rev: current._rev } : {}), _deleted: true }
      })
      return outcome
    },
  }
}
