import { describe, expect, it } from 'vitest'
import { createLeaseKeeper } from './hostLease.js'

function keeper(listed = ['laptop', 'stage-pc'], self = 'stage-pc') {
  let t = 1_000
  const k = createLeaseKeeper({ selfHostId: self, listedHostIds: () => listed, now: () => t })
  return { k, advance: (ms: number) => (t += ms) }
}
const lease = (over: object = {}) => ({ hostId: 'laptop', epoch: 1, leaseMs: 4000, ...over })

describe('createLeaseKeeper (#918)', () => {
  it('has no lease before the first one arrives', () => {
    expect(keeper().k.status()).toBeNull()
  })

  it('accepts a lease from the other listed host and is alive until its length has passed on the OWN clock', () => {
    const { k, advance } = keeper()
    expect(k.accept(lease())).toBe('accepted')
    advance(3_999)
    expect(k.status()).toMatchObject({ hostId: 'laptop', epoch: 1, alive: true })
    advance(2)
    expect(k.status()).toMatchObject({ alive: false })
  })

  it('a fresh lease extends it', () => {
    const { k, advance } = keeper()
    k.accept(lease())
    advance(3_000)
    k.accept(lease())
    advance(3_000)
    expect(k.status()?.alive).toBe(true)
  })

  it('ignores a message that fails the schema, one from an unlisted host, and one from itself', () => {
    const { k } = keeper()
    expect(k.accept({ hostId: 'laptop' })).toBe('ignored')
    expect(k.accept(lease({ hostId: 'stranger' }))).toBe('ignored')
    expect(k.accept(lease({ hostId: 'stage-pc' }))).toBe('ignored')
    expect(k.status()).toBeNull()
  })

  it('ignores a lease with a lower epoch than the one already held (a stale primary)', () => {
    const { k } = keeper()
    k.accept(lease({ epoch: 2 }))
    expect(k.accept(lease({ epoch: 1 }))).toBe('ignored')
    expect(k.status()?.epoch).toBe(2)
  })

  it('takes a higher epoch', () => {
    const { k } = keeper()
    k.accept(lease({ epoch: 1 }))
    expect(k.accept(lease({ epoch: 2 }))).toBe('accepted')
    expect(k.status()?.epoch).toBe(2)
  })

  it('ignores everything when the band lists fewer than two hosts', () => {
    const { k } = keeper(['laptop'])
    expect(k.accept(lease())).toBe('ignored')
  })
})
