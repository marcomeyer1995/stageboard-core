import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveDeletedBand } from './deletedBand.js'

const config = { url: 'http://db', user: 'admin', password: 'pw' }
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'deleted-band-'))
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

describe('keeping a band that is being deleted (#362: a deleted band stays recoverable)', () => {
  it('writes every document and the access rules, in the format scripts/backup-restore.mjs reads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
        if (url.includes('/_all_docs')) return json({ rows: [{ doc: { _id: 'profiles:p1', _rev: '1-a', name: 'Anna' } }, { doc: { _id: 'account:stageboard-band-p1~d1', _rev: '2-b', derived_key: 'abc' } }] })
        if (url.endsWith('/_security')) return json({ admins: { roles: ['admin'] } })
        return new Response('{}', { status: 404 })
      }),
    )

    const file = await saveDeletedBand(config, 'band', dir, () => new Date('2026-11-19T10:30:00Z'))

    expect(file).toBe(join(dir, 'deleted-bands', 'stageboard-band-2026-11-19_1030', 'couchdb', 'stageboard-band.json'))
    const dump = JSON.parse(readFileSync(file!, 'utf-8'))
    expect(dump.db).toBe('stageboard-band')
    expect(dump.security).toEqual({ admins: { roles: ['admin'] } })
    expect(dump.docs.map((d: { _id: string }) => d._id)).toEqual(['profiles:p1', 'account:stageboard-band-p1~d1'])
  })

  it('keeps the copy private to its owner - it holds logins and the access code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ rows: [] }), { status: 200 })))
    const file = await saveDeletedBand(config, 'band', dir)
    const { statSync } = await import('node:fs')
    expect(statSync(file!).mode & 0o077).toBe(0)
  })

  it('says null for a database that is already gone - there is nothing to keep, and the delete goes on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    expect(await saveDeletedBand(config, 'band', dir)).toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })

  it('passes any other failure on - a band must not be deleted when its copy could not be made', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    await expect(saveDeletedBand(config, 'band', dir)).rejects.toThrow()
  })
})
