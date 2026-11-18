import { describe, expect, it } from 'vitest'
import { createLeaseKeeper } from './hostLease.js'
import { leaseKey, signLease } from './hostLeaseAuth.js'

const KEY = leaseKey('12345678', 'band-a')

function keeper(listed = ['laptop', 'stage-pc'], self = 'stage-pc', keys: () => Buffer[] = () => [KEY]) {
  let t = 1_000
  const k = createLeaseKeeper({ selfHostId: self, listedHostIds: () => listed, keys, now: () => t })
  return { k, advance: (ms: number) => (t += ms) }
}
let seq = 0
const signed = (over: object = {}, key = KEY) => signLease({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: ++seq, ...over }, key)

describe('createLeaseKeeper (#918)', () => {
  it('has no lease before the first one arrives', () => {
    expect(keeper().k.status()).toBeNull()
  })

  it('accepts a signed lease from the other listed host, alive until its length has passed on the OWN clock', () => {
    const { k, advance } = keeper()
    expect(k.accept(signed())).toBe('accepted')
    advance(3_999)
    expect(k.status()).toMatchObject({ hostId: 'laptop', epoch: 1, alive: true })
    advance(2)
    expect(k.status()).toMatchObject({ alive: false })
  })

  it('a fresh lease extends it', () => {
    const { k, advance } = keeper()
    k.accept(signed())
    advance(3_000)
    k.accept(signed())
    advance(3_000)
    expect(k.status()?.alive).toBe(true)
  })

  it('ignores a bad signature, an unsigned message, an unlisted host and itself', () => {
    const { k } = keeper()
    expect(k.accept(signed({}, leaseKey('00000000', 'band-a')))).toBe('ignored')
    expect(k.accept({ hostId: 'laptop', epoch: 1, leaseMs: 4000 })).toBe('ignored')
    expect(k.accept(signed({ hostId: 'stranger' }))).toBe('ignored')
    expect(k.accept(signed({ hostId: 'stage-pc' }))).toBe('ignored')
    expect(k.status()).toBeNull()
  })

  it('ignores a replayed lease: sentAt must rise', () => {
    const { k } = keeper()
    const first = signed({ sentAt: 100 })
    expect(k.accept(first)).toBe('accepted')
    expect(k.accept(first)).toBe('ignored')
    expect(k.accept(signed({ sentAt: 99 }))).toBe('ignored')
    expect(k.accept(signed({ sentAt: 101 }))).toBe('accepted')
  })

  it('ignores a lower epoch than held, takes a higher one', () => {
    const { k } = keeper()
    k.accept(signed({ epoch: 2 }))
    expect(k.accept(signed({ epoch: 1 }))).toBe('ignored')
    expect(k.accept(signed({ epoch: 3 }))).toBe('accepted')
    expect(k.status()?.epoch).toBe(3)
  })

  it('accepts a lease signed with any key it is given (the band code changing mid-gig)', () => {
    const next = leaseKey('99999999', 'band-a')
    const { k } = keeper(undefined, undefined, () => [next, KEY])
    expect(k.accept(signed({}, KEY))).toBe('accepted')
    expect(k.accept(signed({}, next))).toBe('accepted')
  })

  it('ignores everything when the band lists fewer than two hosts', () => {
    expect(keeper(['laptop']).k.accept(signed())).toBe('ignored')
  })
})
