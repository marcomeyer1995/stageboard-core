import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Same reasoning as workspaceCollection.test.ts: real PouchDB needs IndexedDB, unavailable
// under happy-dom. This fake only needs to record constructor args (db name, remote URL +
// auth options) and hand back a no-op `.sync()` handle - trackedSync.ts drives the rest.
const constructed: Array<{ name: string; options?: unknown }> = []

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    name: string
    constructor(name: string, options?: unknown) {
      this.name = name
      constructed.push({ name, options })
    }
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { localDbName, remoteDbUrl, startWorkspaceSync } = await import('./workspaceDb')

beforeEach(() => {
  constructed.length = 0
})

afterEach(() => {
  // Object.assign(env, originalEnv) wouldn't remove a key a test just added - it only
  // overwrites keys already present in the source - so unset explicitly instead.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (import.meta.env as any).VITE_COUCHDB_URL
})

describe('localDbName', () => {
  it('derives a stageboard-<id> name', () => {
    expect(localDbName('band-a')).toBe('stageboard-band-a')
  })
})

describe('remoteDbUrl', () => {
  it('rewrites the base URL\'s last path segment to the workspace database name', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_COUCHDB_URL = 'https://localhost:6984/stageboard-band-a'
    expect(remoteDbUrl('band-b')).toBe('https://localhost:6984/stageboard-band-b')
  })

  it('returns null when VITE_COUCHDB_URL is not configured', () => {
    expect(remoteDbUrl('band-a')).toBeNull()
  })
})

describe('startWorkspaceSync', () => {
  it('opens the remote PouchDB with exactly the given credentials, not any global/env ones', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_COUCHDB_URL = 'https://localhost:6984/stageboard-band-a'

    startWorkspaceSync('band-a', { username: 'stageboard-band-a', password: 'secret-pw' })

    const remote = constructed.find((c) => c.name === 'https://localhost:6984/stageboard-band-a')
    expect(remote?.options).toEqual({ auth: { username: 'stageboard-band-a', password: 'secret-pw' } })
  })

  it('returns null without constructing a remote db when VITE_COUCHDB_URL is unset', () => {
    const result = startWorkspaceSync('band-a', { username: 'stageboard-band-a', password: 'secret-pw' })
    expect(result).toBeNull()
  })
})
