import { describe, expect, it } from 'vitest'
import { BandSettingsSchema, hostsByPriority, type BandHostEntry } from './bandSettings.js'

const FP = 'a'.repeat(64)
const primary: BandHostEntry = { hostId: 'laptop', url: 'https://192.168.1.10:8443', certFingerprint: FP, priority: 1 }
const backup: BandHostEntry = { hostId: 'stage-pc', url: 'https://192.168.1.11:8443', certFingerprint: 'b'.repeat(64), priority: 2 }
const parse = (hosts: unknown) => BandSettingsSchema.safeParse({ id: 'band', hosts })

describe('BandSettings.hosts (#912)', () => {
  it('is optional - every existing band has none', () => {
    expect(BandSettingsSchema.safeParse({ id: 'band' }).success).toBe(true)
  })

  it('accepts a primary and a backup, and a host without a fingerprint (no pinning)', () => {
    expect(parse([primary, backup]).success).toBe(true)
    expect(parse([{ hostId: 'laptop', url: 'https://x.local', priority: 1 }]).success).toBe(true)
  })

  it('may name the stage-map box the host runs on, and rejects an empty name', () => {
    expect(parse([{ ...primary, equipmentId: 'laptop-box' }]).success).toBe(true)
    expect(parse([{ ...primary, equipmentId: '' }]).success).toBe(false)
  })

  it('rejects more than two hosts', () => {
    expect(parse([primary, backup, { ...backup, hostId: 'third', priority: 1 }]).success).toBe(false)
  })

  it('rejects a repeated hostId or a repeated priority', () => {
    expect(parse([primary, { ...backup, hostId: 'laptop' }]).success).toBe(false)
    expect(parse([primary, { ...backup, priority: 1 }]).success).toBe(false)
  })

  it('rejects a url that is not https', () => {
    expect(parse([{ ...primary, url: 'http://192.168.1.10' }]).success).toBe(false)
  })

  it('rejects a fingerprint that is not 64 lowercase hex characters', () => {
    for (const certFingerprint of ['A'.repeat(64), 'a'.repeat(63), 'aa:'.repeat(21) + 'a', 'g'.repeat(64)]) {
      expect(parse([{ ...primary, certFingerprint }]).success).toBe(false)
    }
  })
})

describe('hostsByPriority (#912)', () => {
  it('puts the primary before the backup whatever the stored order, and is empty without hosts', () => {
    expect(hostsByPriority([backup, primary]).map((h) => h.hostId)).toEqual(['laptop', 'stage-pc'])
    expect(hostsByPriority(undefined)).toEqual([])
  })
})
