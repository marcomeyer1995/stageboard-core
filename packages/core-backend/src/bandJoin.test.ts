import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import type { Bootstrap } from 'sync-host'
import { createBandBootstrapStore } from './bandJoin.js'

const FP = 'a'.repeat(64)
const primary: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', certFingerprint: FP, priority: 1 }
const self: BandHostEntry = { hostId: 'stage-pc', url: 'https://10.0.0.2:8443', priority: 2 }

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'join-'))
  return { dir, store: createBandBootstrapStore(dir) }
}

describe('bootstrap store (#933)', () => {
  it('keeps what was saved across a restart, in a file only its owner can read', () => {
    const { store, dir } = setup()
    const b: Bootstrap = { workspaceId: 'band-a', accessCode: '12345678', hosts: [primary, self] }
    store.save(b)
    expect(createBandBootstrapStore(dir).load()).toEqual(b)
    expect(statSync(join(dir, 'join-band.json')).mode & 0o077).toBe(0)
    expect(readFileSync(join(dir, 'join-band.json'), 'utf8')).toContain('12345678')
  })

  it('a missing or broken file is "not joined", never an error', () => {
    const { store, dir } = setup()
    expect(store.load()).toBeNull()
    writeFileSync(join(dir, 'join-band.json'), '{nonsense')
    expect(store.load()).toBeNull()
    writeFileSync(join(dir, 'join-band.json'), JSON.stringify({ workspaceId: 'x', accessCode: '', hosts: [] }))
    expect(store.load()).toBeNull()
  })
})

