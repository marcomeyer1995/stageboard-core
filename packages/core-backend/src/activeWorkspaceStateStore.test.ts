import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readPersistedActiveWorkspace, writePersistedActiveWorkspace } from './activeWorkspaceStateStore.js'

describe('activeWorkspaceStateStore', () => {
  let stateDir: string

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'stageboard-active-workspace-test-'))
    process.env.STAGEBOARD_STATE_DIR = stateDir
  })

  afterEach(() => {
    delete process.env.STAGEBOARD_STATE_DIR
    rmSync(stateDir, { recursive: true, force: true })
  })

  it('returns null when no state file exists yet', () => {
    expect(readPersistedActiveWorkspace()).toBeNull()
  })

  it('round-trips a written workspace id', () => {
    writePersistedActiveWorkspace('abadschendaler')
    expect(readPersistedActiveWorkspace()).toBe('abadschendaler')
  })

  it('overwrites a previously persisted workspace id', () => {
    writePersistedActiveWorkspace('abadschendaler')
    writePersistedActiveWorkspace('soat')
    expect(readPersistedActiveWorkspace()).toBe('soat')
  })

  it('returns null and does not throw on corrupt JSON', () => {
    writeFileSync(join(stateDir, 'active-workspace.json'), 'not json{{{')
    expect(readPersistedActiveWorkspace()).toBeNull()
  })

  it('returns null and does not throw when workspaceId field is missing', () => {
    writeFileSync(join(stateDir, 'active-workspace.json'), JSON.stringify({ somethingElse: true }))
    expect(readPersistedActiveWorkspace()).toBeNull()
  })
})
