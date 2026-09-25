import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IShowControlPlugin, PluginContext } from 'shared-types'

const pluginSyncStop = vi.fn()
const midiWatcherStop = vi.fn()
const asyncJobWatcherStop = vi.fn()

vi.mock('./plugins/pluginSync.js', () => ({
  createPluginSync: vi.fn(() => ({
    stop: pluginSyncStop,
    syncOnce: vi.fn(),
    writeHeartbeat: vi.fn(),
  })),
}))

vi.mock('./midiWatcher.js', () => ({
  createMidiWatcher: vi.fn(() => ({ stop: midiWatcherStop })),
}))

vi.mock('./asyncJobWatcher.js', () => ({
  createAsyncJobWatcher: vi.fn(() => ({ stop: asyncJobWatcherStop, syncOnce: vi.fn() })),
}))

import { createPluginSync } from './plugins/pluginSync.js'
import { createMidiWatcher } from './midiWatcher.js'
import { createAsyncJobWatcher } from './asyncJobWatcher.js'
import { createWorkspaceHardwareController } from './workspaceHardwareController.js'
import { PluginRegistry } from './plugins/registry.js'

function testContext(): PluginContext {
  return { log: { info: vi.fn(), error: vi.fn() } }
}

function fakeShowControlPlugin(overrides: Partial<IShowControlPlugin> = {}): IShowControlPlugin {
  return {
    name: 'fake-mixer',
    version: '0.0.1',
    capabilities: [],
    init: vi.fn(),
    shutdown: vi.fn(),
    trigger: vi.fn(async () => ({ status: 'ok' as const, data: {} })),
    ...overrides,
  }
}

describe('workspaceHardwareController', () => {
  let stateDir: string

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'stageboard-workspace-hardware-test-'))
    process.env.STAGEBOARD_STATE_DIR = stateDir
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.STAGEBOARD_STATE_DIR
    rmSync(stateDir, { recursive: true, force: true })
  })

  function makeController(registry = new PluginRegistry()) {
    return {
      registry,
      controller: createWorkspaceHardwareController({
        couch: {} as never,
        registry,
        log: { info: vi.fn(), error: vi.fn() },
      }),
    }
  }

  it('has no active workspace before anything is activated', () => {
    const { controller } = makeController()
    expect(controller.getActiveWorkspaceId()).toBeNull()
  })

  it('activating stops the previously active workspace and starts the new one', async () => {
    const { controller } = makeController()

    await controller.activate('abadschendaler')
    expect(createPluginSync).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'abadschendaler' }))
    expect(createMidiWatcher).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'abadschendaler' }))
    expect(createAsyncJobWatcher).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'abadschendaler' }))

    await controller.activate('soat')
    expect(pluginSyncStop).toHaveBeenCalledTimes(1)
    expect(midiWatcherStop).toHaveBeenCalledTimes(1)
    expect(asyncJobWatcherStop).toHaveBeenCalledTimes(1)
    expect(createPluginSync).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'soat' }))
    expect(controller.getActiveWorkspaceId()).toBe('soat')
  })

  it('deactivating unregisters every currently-registered plugin', async () => {
    const { controller, registry } = makeController()
    const plugin = fakeShowControlPlugin()
    await registry.register(plugin, testContext())

    await controller.activate('abadschendaler')
    await controller.deactivate()

    expect(registry.list()).toEqual([])
    expect(plugin.shutdown).toHaveBeenCalledTimes(1)
    expect(controller.getActiveWorkspaceId()).toBeNull()
  })

  it('activate persists the workspace id to the state file', async () => {
    const { controller } = makeController()
    await controller.activate('abadschendaler')

    const persisted = JSON.parse(readFileSync(join(stateDir, 'active-workspace.json'), 'utf-8'))
    expect(persisted).toEqual({ workspaceId: 'abadschendaler' })
  })

  it('deactivate on an already-inactive controller is a safe no-op', async () => {
    const { controller } = makeController()
    await expect(controller.deactivate()).resolves.toBeUndefined()
    expect(pluginSyncStop).not.toHaveBeenCalled()
    expect(midiWatcherStop).not.toHaveBeenCalled()
    expect(asyncJobWatcherStop).not.toHaveBeenCalled()
  })
})
