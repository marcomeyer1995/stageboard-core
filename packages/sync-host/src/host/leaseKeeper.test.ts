import { describe, expect, it } from 'vitest'
import { beforeAll } from 'vitest'
import { createLeaseKeeper } from './leaseKeeper.js'
import { leaseKey, signLease } from './leaseAuth.js'

let KEY: CryptoKey
beforeAll(async () => {
  KEY = await leaseKey('12345678', 'band-a')
})

function keeper(listed = ['laptop', 'stage-pc'], self = 'stage-pc', keys: () => CryptoKey[] = () => [KEY]) {
  let t = 1_000
  const k = createLeaseKeeper({ selfHostId: self, listedHostIds: () => listed, keys: async () => keys(), now: () => t })
  return { k, advance: (ms: number) => (t += ms) }
}
let seq = 0
const signed = async (over: object = {}, key = KEY) => await signLease({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: ++seq, ...over }, key)

describe('createLeaseKeeper (#918)', () => {
  it('has no lease before the first one arrives', async () => {
    expect(keeper().k.status()).toBeNull()
  })

  it('accepts a signed lease from the other listed host, alive until its length has passed on the OWN clock', async () => {
    const { k, advance } = keeper()
    expect(await k.accept(await signed())).toBe('accepted')
    advance(3_999)
    expect(k.status()).toMatchObject({ hostId: 'laptop', epoch: 1, alive: true })
    advance(2)
    expect(k.status()).toMatchObject({ alive: false })
  })

  it('says how long it has been since the last lease arrived', async () => {
    const { k, advance } = keeper()
    await k.accept(await signed())
    advance(6_500)
    expect(k.status()?.silentForMs).toBe(6_500)
  })

  it('a fresh lease extends it', async () => {
    const { k, advance } = keeper()
    await k.accept(await signed())
    advance(3_000)
    await k.accept(await signed())
    advance(3_000)
    expect(k.status()?.alive).toBe(true)
  })

  it('ignores a bad signature, an unsigned message, an unlisted host and itself', async () => {
    const { k } = keeper()
    expect(await k.accept(await signed({}, await leaseKey('00000000', 'band-a')))).toBe('ignored')
    expect(await k.accept({ hostId: 'laptop', epoch: 1, leaseMs: 4000 })).toBe('ignored')
    expect(await k.accept(await signed({ hostId: 'stranger' }))).toBe('ignored')
    expect(await k.accept(await signed({ hostId: 'stage-pc' }))).toBe('ignored')
    expect(k.status()).toBeNull()
  })

  it('ignores a replayed lease: sentAt must rise', async () => {
    const { k } = keeper()
    const first = await signed({ sentAt: 100 })
    expect(await k.accept(first)).toBe('accepted')
    expect(await k.accept(first)).toBe('ignored')
    expect(await k.accept(await signed({ sentAt: 99 }))).toBe('ignored')
    expect(await k.accept(await signed({ sentAt: 101 }))).toBe('accepted')
  })

  it('ignores a lower epoch than held, takes a higher one', async () => {
    const { k } = keeper()
    await k.accept(await signed({ epoch: 2 }))
    expect(await k.accept(await signed({ epoch: 1 }))).toBe('ignored')
    expect(await k.accept(await signed({ epoch: 3 }))).toBe('accepted')
    expect(k.status()?.epoch).toBe(3)
  })

  it('accepts a lease signed with any key it is given (the band code changing mid-gig)', async () => {
    const next = await leaseKey('99999999', 'band-a')
    const { k } = keeper(undefined, undefined, () => [next, KEY])
    expect(await k.accept(await signed({}, KEY))).toBe('accepted')
    expect(await k.accept(await signed({}, next))).toBe('accepted')
  })

  it('ignores everything when the band lists fewer than two hosts', async () => {
    expect(await keeper(['laptop']).k.accept(await signed())).toBe('ignored')
  })
})
