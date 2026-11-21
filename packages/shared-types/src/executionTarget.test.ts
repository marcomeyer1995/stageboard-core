import { describe, expect, it } from 'vitest'
import { isHostTarget, migrateExecutionTarget } from './executionTarget.js'

const world = { hostIds: ['stage-pc', 'tablet-1'], deviceIds: ['tablet-1', 'tablet-2'] }

describe('isHostTarget (#964)', () => {
  it('reads the legacy word as the host', () => expect(isHostTarget('server', world)).toBe(true))
  it('reads a host id nobody in the roster carries as the host (a laptop)', () => expect(isHostTarget('stage-pc', world)).toBe(true))
  it('reads a tablet that is also a host as a device: a binding to it is its own output', () => expect(isHostTarget('tablet-1', world)).toBe(false))
  it('reads a plain tablet as a device', () => expect(isHostTarget('tablet-2', world)).toBe(false))
  it('reads no target as no host', () => {
    expect(isHostTarget(null, world)).toBe(false)
    expect(isHostTarget(undefined, world)).toBe(false)
    expect(isHostTarget('', world)).toBe(false)
  })
  it('does not guess when no host id is known', () => expect(isHostTarget('stage-pc', { hostIds: [], deviceIds: [] })).toBe(false))
})

describe('migrateExecutionTarget (#964)', () => {
  it('rewrites the legacy word to the host that answers', () => expect(migrateExecutionTarget('server', 'stage-pc')).toBe('stage-pc'))
  it('leaves the word while no host is known, so nothing is lost', () => expect(migrateExecutionTarget('server', undefined)).toBe('server'))
  it('leaves a device id alone', () => expect(migrateExecutionTarget('tablet-2', 'stage-pc')).toBe('tablet-2'))
  it('keeps null as null', () => expect(migrateExecutionTarget(null, 'stage-pc')).toBeNull())
})
