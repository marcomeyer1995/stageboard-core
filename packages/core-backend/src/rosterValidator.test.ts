import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROSTER_VALIDATOR_SOURCE, updateRosterValidators } from './workspaceProvisioning.js'

const config = { url: 'http://couch', user: 'admin', password: 'pw' }

afterEach(() => vi.unstubAllGlobals())

describe('updateRosterValidators (#16)', () => {
  it('replaces outdated validators of StageBoard bands only, and leaves current ones alone', async () => {
    const writes: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
        if (url.endsWith('/_all_dbs')) return json(['_users', 'stageboard-old', 'stageboard-new', 'other'])
        if (init?.method === 'PUT') {
          writes.push(url)
          return new Response('{}', { status: 201 })
        }
        if (url.includes('stageboard-old')) return json({ _id: '_design/roster', _rev: '1-a', validate_doc_update: 'function(){}' })
        if (url.includes('stageboard-new')) return json({ _id: '_design/roster', _rev: '2-b', validate_doc_update: ROSTER_VALIDATOR_SOURCE })
        return new Response('{}', { status: 404 })
      }),
    )
    expect(await updateRosterValidators(config)).toEqual(['stageboard-old'])
    expect(writes).toEqual(['http://couch/stageboard-old/_design%2Froster'])
  })

  it('one failing band does not stop the others - it is reported (#401 review)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
        if (url.endsWith('/_all_dbs')) return json(['stageboard-broken', 'stageboard-old'])
        if (url.includes('stageboard-broken')) return new Response('{}', { status: 500 })
        if (init?.method === 'PUT') return new Response('{}', { status: 201 })
        return json({ _id: '_design/roster', _rev: '1-a', validate_doc_update: 'function(){}' })
      }),
    )
    const failed: string[] = []
    expect(await updateRosterValidators(config, (db) => failed.push(db))).toEqual(['stageboard-old'])
    expect(failed).toEqual(['stageboard-broken'])
  })
})

describe('roster validator - band settings', () => {
  // The validator is plain ES5 source for CouchDB; evaluated here the same way.
  const validate = new Function(`return ${ROSTER_VALIDATOR_SOURCE}`)() as (doc: { _id: string }, old: unknown, ctx: { roles: string[] }) => void

  it('only a band admin may change the band settings (Geprobt period, 2026-10-07)', () => {
    expect(() => validate({ _id: 'band-settings:band' }, null, { roles: ['member'] })).toThrow()
    expect(() => validate({ _id: 'band-settings:band' }, null, { roles: ['admin'] })).not.toThrow()
    expect(() => validate({ _id: 'setlists:x' }, null, { roles: ['member'] })).not.toThrow()
  })
})

describe('roster validator - server tablets (docs/25 §6c)', () => {
  const validate = new Function(`return ${ROSTER_VALIDATOR_SOURCE}`)() as (doc: { _id: string; _deleted?: boolean }, old: unknown, ctx: { name?: string; roles: string[] }) => void
  const redmi = { name: 'stageboard-band-p1~dev-redmi', roles: ['member'] }

  it('only the tablet itself writes its certificate entry - not another tablet, not a band admin', () => {
    expect(() => validate({ _id: 'hosts:dev-redmi' }, null, redmi)).not.toThrow()
    expect(() => validate({ _id: 'hosts:dev-redmi' }, null, { name: 'stageboard-band-p2~dev-fire', roles: ['member', 'admin'] })).toThrow()
    // A device id that only ends like another one is not that device.
    expect(() => validate({ _id: 'hosts:dev-redmi' }, null, { name: 'stageboard-band-p1~xdev-redmi', roles: ['member'] })).toThrow()
    expect(() => validate({ _id: 'hosts:other-redmi' }, null, redmi)).toThrow()
    expect(() => validate({ _id: 'hosts:dev-redmi' }, null, { roles: ['_admin'] })).not.toThrow()
  })

  it('a band admin may remove an old entry', () => {
    expect(() => validate({ _id: 'hosts:dev-redmi', _deleted: true }, null, { name: 'stageboard-band-p2~dev-fire', roles: ['member', 'admin'] })).not.toThrow()
    expect(() => validate({ _id: 'hosts:dev-redmi', _deleted: true }, null, { name: 'stageboard-band-p3~dev-x', roles: ['member'] })).toThrow()
  })
})
