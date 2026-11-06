import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Same reasoning as workspaceCollection.test.ts: real PouchDB needs IndexedDB, unavailable
// under happy-dom. This fake only needs to record constructor args (db name, remote URL +
// auth options) and hand back a no-op `.sync()` handle - trackedSync.ts drives the rest.
const constructed: Array<{ name: string; options?: unknown }> = []
const destroyed: string[] = []

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
    destroy() {
      destroyed.push(this.name)
      return Promise.resolve()
    }
  },
}))

const { destroyLocalWorkspaceDb, isStatusDocId, localDbName, remoteDbUrl, startWorkspaceSync } = await import('./workspaceDb')

beforeEach(() => {
  constructed.length = 0
  destroyed.length = 0
})

afterEach(() => {
  // Object.assign(env, originalEnv) wouldn't remove a key a test just added - it only
  // overwrites keys already present in the source - so unset explicitly instead.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (import.meta.env as any).VITE_STAGE_SERVER_URL
})

describe('localDbName', () => {
  it('derives a stageboard-<id> name', () => {
    expect(localDbName('band-a')).toBe('stageboard-band-a')
  })
})

describe('remoteDbUrl', () => {
  it('2026-09-02 fourth follow-up: builds the workspace database URL through the Stage-Server\'s own /db proxy, not CouchDB\'s own port', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
    expect(remoteDbUrl('band-b')).toBe('https://stage-server:3001/db/stageboard-band-b')
  })

  it('strips a trailing slash from the Stage-Server URL before appending the /db path', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001/'
    expect(remoteDbUrl('band-b')).toBe('https://stage-server:3001/db/stageboard-band-b')
  })

  it('returns null when no Stage-Server is configured at all', () => {
    expect(remoteDbUrl('band-a')).toBeNull()
  })
})

describe('destroyLocalWorkspaceDb', () => {
  it('destroys the local PouchDB by its stageboard-<id> name, without touching the remote database', async () => {
    await destroyLocalWorkspaceDb('band-a')
    expect(destroyed).toEqual(['stageboard-band-a'])
  })
})

describe('startWorkspaceSync', () => {
  it('opens the remote PouchDB with exactly the given credentials, not any global/env ones', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'

    startWorkspaceSync('band-a', { username: 'stageboard-band-a', password: 'secret-pw' })

    const remote = constructed.find((c) => c.name === 'https://stage-server:3001/db/stageboard-band-a')
    expect(remote?.options).toEqual({ auth: { username: 'stageboard-band-a', password: 'secret-pw' } })
  })

  it('returns null without constructing a remote db when no Stage-Server is configured', () => {
    const result = startWorkspaceSync('band-a', { username: 'stageboard-band-a', password: 'secret-pw' })
    expect(result).toBeNull()
  })
})

describe('isStatusDocId (2026-11-06: no sync symbol for the running show)', () => {
  it('counts the show, its log, job progress and an align session as status', () => {
    expect(isStatusDocId('show-state')).toBe(true)
    expect(isStatusDocId('showlog:cue-s1-123-c1')).toBe(true)
    expect(isStatusDocId('async-jobs:42')).toBe(true)
    expect(isStatusDocId('alignment-session')).toBe(true)
  })

  it('everything saved in the Bibliothek and the settings is real', () => {
    for (const id of ['songs:1', 'setlists:1', 'song-variants:1', 'dashboards:1', 'logical-devices:1', 'band-settings:main', 'show-protection:s1', 'practice-log:1']) {
      expect(isStatusDocId(id)).toBe(false)
    }
  })
})
