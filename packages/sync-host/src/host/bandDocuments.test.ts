import { describe, expect, it } from 'vitest'
import { createBandDocuments, type BandDocument, type BandDocumentPort } from './bandDocuments.js'
import { ROSTER_VALIDATOR_SOURCE } from './rosterValidator.js'

/** One band's documents in memory, CouchDB-like: a write needs the current `_rev`, a stale one is a conflict. */
function memoryBand(initial: BandDocument[] = []) {
  const docs = new Map<string, BandDocument>(initial.map((d) => [d._id, { ...d, _rev: d._rev ?? '1-a' }]))
  let conflictsLeft = 0
  const port: BandDocumentPort = {
    get: async (id) => (docs.has(id) ? { ...docs.get(id)! } : null),
    async update(id, change) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = docs.has(id) ? { ...docs.get(id)! } : null
        const next = change(existing)
        if (!next) return
        if (conflictsLeft > 0) {
          conflictsLeft--
          // Another device wrote first: the stored doc moves on, this write is refused.
          if (existing) docs.set(id, { ...existing, _rev: `${Number(existing._rev?.split('-')[0] ?? 0) + 1}-x`, touchedBy: 'other' })
          continue
        }
        if ((existing?._rev ?? undefined) !== next._rev) throw new Error('stale write')
        if (next._deleted) docs.delete(id)
        else docs.set(id, { ...next, _rev: `${Number(next._rev?.split('-')[0] ?? 0) + 1}-y` })
        return
      }
      throw new Error('conflict')
    },
    list: async (prefix) => [...docs.values()].filter((d) => d._id.startsWith(prefix)),
  }
  return { port, docs, conflictOnce: () => (conflictsLeft = 1) }
}

let next = 0
const setUp = (initial: BandDocument[] = []) => {
  const band = memoryBand(initial)
  const documents = createBandDocuments({ open: () => band.port, newCode: () => String(11111111 + next++) })
  return { band, documents }
}

describe('the access doc of a band - once for every host (#964)', () => {
  it('founding writes code, name and the founding host; reading gives code and name', async () => {
    const { band, documents } = setUp()
    const code = await documents.createAccess('b', 'Die Band', 'tablet-1')
    expect(await documents.accessCode('b')).toEqual({ code, name: 'Die Band' })
    expect(band.docs.get('workspace:access')).toMatchObject({ hostId: 'tablet-1' })
  })

  it('rename, a new code and the master mode keep every other field - also the founding host (the laptop used to drop it)', async () => {
    const { band, documents } = setUp([{ _id: 'workspace:access', code: '12345678', name: 'Alt', hostId: 'tablet-1', masterMode: 'account', extra: 1 }])
    await documents.rename('b', 'Neu')
    expect(band.docs.get('workspace:access')).toMatchObject({ code: '12345678', name: 'Neu', hostId: 'tablet-1', masterMode: 'account', extra: 1 })
    const code = await documents.rotateAccessCode('b')
    expect(code).not.toBe('12345678')
    expect(band.docs.get('workspace:access')).toMatchObject({ code, name: 'Neu', hostId: 'tablet-1', masterMode: 'account' })
    await documents.setMasterMode('b', 'device')
    expect(band.docs.get('workspace:access')).toMatchObject({ code, name: 'Neu', hostId: 'tablet-1', masterMode: 'device' })
  })

  it('a band from before the standing code gets one on its first request, and keeps it after', async () => {
    const { documents } = setUp()
    expect(await documents.accessCode('b')).toBeNull()
    const made = await documents.ensureAccessCode('b', 'b')
    expect(made.code).toMatch(/^\d{8}$/)
    expect(await documents.ensureAccessCode('b', 'other')).toEqual(made)
  })

  it('a write that loses against another device is made again on the new revision - nothing of the other write is lost', async () => {
    const { band, documents } = setUp([{ _id: 'workspace:access', code: '12345678', name: 'Alt' }])
    band.conflictOnce()
    await documents.rename('b', 'Neu')
    expect(band.docs.get('workspace:access')).toMatchObject({ name: 'Neu', code: '12345678', touchedBy: 'other' })
  })

  it('generated codes are 8 digits', async () => {
    const { generateAccessCode } = await import('./bandDocuments.js')
    for (let i = 0; i < 50; i++) expect(generateAccessCode()).toMatch(/^\d{8}$/)
  })
})

describe('the Device Ledger: block and clean up (#958, #964)', () => {
  const device = { _id: 'devices:fire', name: 'Fire' }

  it('blocks and lets in again; a device the band never saw is unknown', async () => {
    const { band, documents } = setUp([device])
    expect(await documents.setDeviceRevoked('b', 'fire', true)).toBe('ok')
    expect(band.docs.get('devices:fire')).toMatchObject({ revoked: true, name: 'Fire' })
    expect(await documents.setDeviceRevoked('b', 'fire', false)).toBe('ok')
    expect(band.docs.get('devices:fire')).toMatchObject({ revoked: false })
    expect(await documents.setDeviceRevoked('b', 'ghost', true)).toBe('unknown')
    expect(band.docs.has('devices:ghost')).toBe(false)
  })

  it('removes a device from the list - not a blocked one, not one a hardware device runs on, not one it never saw', async () => {
    const { band, documents } = setUp([device, { _id: 'devices:redmi', revoked: true }, { _id: 'devices:laptop' }, { _id: 'logical-devices:kemper', name: 'Kemper', executionTarget: 'laptop' }])
    expect(await documents.forgetDevice('b', 'redmi')).toBe('blocked')
    expect(await documents.forgetDevice('b', 'laptop')).toEqual({ usedBy: ['Kemper'] })
    expect(await documents.forgetDevice('b', 'ghost')).toBe('unknown')
    expect(await documents.forgetDevice('b', 'fire')).toBe('ok')
    expect(band.docs.has('devices:fire')).toBe(false)
    expect(band.docs.has('devices:redmi')).toBe(true)
  })

  it('a block that arrives between the check and the delete is seen - the device is not deleted over it', async () => {
    const band = memoryBand([device])
    const port: BandDocumentPort = {
      ...band.port,
      async update(id, change) {
        // Another admin blocks the device right after it was read for the check.
        band.docs.set(id, { ...band.docs.get(id)!, revoked: true, _rev: '2-z' })
        return band.port.update(id, change)
      },
    }
    const documents = createBandDocuments({ open: () => port })
    expect(await documents.forgetDevice('b', 'fire')).toBe('blocked')
    expect(band.docs.has('devices:fire')).toBe(true)
  })
})

describe("a band's write rules (_design/roster) - written at founding, brought up to date on every host (#16, #964)", () => {
  it('founding writes the current rules', async () => {
    const { band, documents } = setUp()
    await documents.writeRules('b')
    expect(band.docs.get('_design/roster')).toMatchObject({ validate_doc_update: ROSTER_VALIDATOR_SOURCE })
  })

  it('old rules are replaced, current ones left alone, a band without rules is not given any', async () => {
    const old = setUp([{ _id: '_design/roster', validate_doc_update: 'function () {}', views: { x: 1 } }])
    expect(await old.documents.updateRules('b')).toBe(true)
    expect(old.band.docs.get('_design/roster')).toMatchObject({ validate_doc_update: ROSTER_VALIDATOR_SOURCE, views: { x: 1 } })
    expect(await old.documents.updateRules('b')).toBe(false)
    const none = setUp()
    expect(await none.documents.updateRules('b')).toBe(false)
    expect(none.band.docs.has('_design/roster')).toBe(false)
  })
})
