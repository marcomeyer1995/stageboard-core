import { describe, expect, it } from 'vitest'
import type { PluginInstallation } from 'shared-types'
import { readInstallations, reconcile } from './pluginSync.js'

const CATALOG = ['mock-mixer', 'mock-lighting']

function installation(overrides: Partial<PluginInstallation> = {}): PluginInstallation {
  return {
    id: 'mock-mixer',
    name: 'Mock Mixer',
    version: '0.0.1',
    runtime: 'server',
    capabilities: ['mixer'],
    enabled: true,
    installedAt: 0,
    ...overrides,
  }
}

describe('reconcile', () => {
  it('starts an installed plugin that is not running yet', () => {
    expect(reconcile([installation()], [], CATALOG)).toEqual({
      toRegister: ['mock-mixer'],
      toUnregister: [],
      unavailable: [],
    })
  })

  it('leaves an already running plugin alone', () => {
    const result = reconcile([installation()], ['mock-mixer'], CATALOG)
    expect(result.toRegister).toEqual([])
    expect(result.toUnregister).toEqual([])
  })

  it('stops a plugin that was disabled in the PWA', () => {
    const result = reconcile([installation({ enabled: false })], ['mock-mixer'], CATALOG)
    expect(result.toUnregister).toEqual(['mock-mixer'])
  })

  it('stops a plugin whose installation was deleted', () => {
    expect(reconcile([], ['mock-mixer'], CATALOG).toUnregister).toEqual(['mock-mixer'])
  })

  it('ignores client-side plugins - they run on the tablet, not here', () => {
    const webmidi = installation({ id: 'generic-webmidi', runtime: 'client' })
    const result = reconcile([webmidi], [], CATALOG)
    expect(result.toRegister).toEqual([])
    expect(result.unavailable).toEqual([])
  })

  it('reports an installed plugin this server build cannot construct', () => {
    const result = reconcile([installation({ id: 'fancy-mixer' })], [], CATALOG)
    expect(result.toRegister).toEqual([])
    expect(result.unavailable).toEqual(['fancy-mixer'])
  })
})

describe('readInstallations', () => {
  it('keeps valid documents and drops malformed ones', () => {
    const docs = [installation(), { _id: 'junk', name: 'no id or version' }, null]
    expect(readInstallations(docs).map((plugin) => plugin.id)).toEqual(['mock-mixer'])
  })
})
