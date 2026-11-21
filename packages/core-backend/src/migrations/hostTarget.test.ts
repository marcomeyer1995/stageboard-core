import { describe, expect, it } from 'vitest'
import { planHostTargetMigration, type BandDocs } from './hostTarget.js'

const docs = (over: Partial<BandDocs> = {}): BandDocs => ({ logicalDevices: [], latencyProfiles: [], transportConfigs: [], equipment: [], front: [], ...over })

describe('planHostTargetMigration (#964)', () => {
  it("binds a logical device that names the legacy word to the host's id", () => {
    const plan = planHostTargetMigration(docs({ logicalDevices: [{ _id: 'logical-devices:l1', id: 'l1', executionTarget: 'server' }, { _id: 'logical-devices:l2', id: 'l2', executionTarget: 'tablet-1' }] }), 'stage-pc')
    expect(plan.puts).toEqual([{ _id: 'logical-devices:l1', id: 'l1', executionTarget: 'stage-pc' }])
    expect(plan.deletes).toEqual([])
  })

  it('moves a stored latency to the id the host goes by, and removes the old document', () => {
    const plan = planHostTargetMigration(docs({ latencyProfiles: [{ _id: 'latency-profile:server:dmx:-', _rev: '1-a', id: 'server:dmx:-', deviceId: 'server', output: 'dmx', route: null, latencyMs: 41, source: 'measured' }] }), 'stage-pc')
    expect(plan.puts).toEqual([{ _id: 'latency-profile:stage-pc:dmx:-', id: 'stage-pc:dmx:-', deviceId: 'stage-pc', output: 'dmx', route: null, latencyMs: 41, source: 'measured' }])
    expect(plan.deletes).toEqual(['latency-profile:server:dmx:-'])
  })

  it('does not overwrite a value already stored under the host id; the legacy one is just dropped', () => {
    const plan = planHostTargetMigration(
      docs({
        latencyProfiles: [
          { _id: 'latency-profile:server:dmx:-', id: 'server:dmx:-', deviceId: 'server', output: 'dmx', route: null, latencyMs: 41, source: 'measured' },
          { _id: 'latency-profile:stage-pc:dmx:-', id: 'stage-pc:dmx:-', deviceId: 'stage-pc', output: 'dmx', route: null, latencyMs: 30, source: 'manual' },
        ],
      }),
      'stage-pc',
    )
    expect(plan.puts).toEqual([])
    expect(plan.deletes).toEqual(['latency-profile:server:dmx:-'])
  })

  it("moves the host's transport config (OSC address) the same way", () => {
    const plan = planHostTargetMigration(docs({ transportConfigs: [{ _id: 'device-transport-config:server:osc1', id: 'server:osc1', deviceId: 'server', logicalDeviceId: 'osc1', transportId: 'osc', values: { host: '10.0.0.5' } }] }), 'stage-pc')
    expect(plan.puts).toEqual([{ _id: 'device-transport-config:stage-pc:osc1', id: 'stage-pc:osc1', deviceId: 'stage-pc', logicalDeviceId: 'osc1', transportId: 'osc', values: { host: '10.0.0.5' } }])
    expect(plan.deletes).toEqual(['device-transport-config:server:osc1'])
  })

  it('renames the host app on a stage-map box and in the front claim', () => {
    const plan = planHostTargetMigration(
      docs({ equipment: [{ _id: 'stage-equipment:b1', id: 'b1', appIds: ['server', 'x'] }, { _id: 'stage-equipment:b2', id: 'b2', appIds: ['x'] }], front: [{ _id: 'stage-front:b1', id: 'b1', appId: 'server', at: 1 }] }),
      'stage-pc',
    )
    expect(plan.puts).toEqual([{ _id: 'stage-equipment:b1', id: 'b1', appIds: ['stage-pc', 'x'] }, { _id: 'stage-front:b1', id: 'b1', appId: 'stage-pc', at: 1 }])
  })

  it('has nothing to do once it has run', () => {
    const plan = planHostTargetMigration(docs({ logicalDevices: [{ _id: 'logical-devices:l1', id: 'l1', executionTarget: 'stage-pc' }] }), 'stage-pc')
    expect(plan).toEqual({ puts: [], deletes: [] })
  })
})
