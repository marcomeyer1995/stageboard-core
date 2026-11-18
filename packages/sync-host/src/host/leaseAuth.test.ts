import { beforeAll, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { leaseKey, signAccountRequest, signLease, verifyAccountRequest, verifyLease } from './leaseAuth.js'

const lease = { hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 1_000 }

describe('host lease signature (#918)', () => {
  it('verifies with the same band code and workspace', async () => {
    const key = await leaseKey('12345678', 'band-a')
    expect(await verifyLease(await signLease(lease, key), key)).toEqual(lease)
  })

  it('refuses another code, another workspace, or a changed field', async () => {
    const key = await leaseKey('12345678', 'band-a')
    const signed = await signLease(lease, key)
    expect(await verifyLease(signed, await leaseKey('87654321', 'band-a'))).toBeNull()
    expect(await verifyLease(signed, await leaseKey('12345678', 'band-b'))).toBeNull()
    expect(await verifyLease({ ...signed, lease: { ...lease, epoch: 2 } }, key)).toBeNull()
    expect(await verifyLease({ ...signed, lease: { ...lease, sentAt: 2_000 } }, key)).toBeNull()
  })

  it('refuses garbage instead of throwing', async () => {
    const key = await leaseKey('12345678', 'band-a')
    for (const bad of [null, 'x', {}, { lease, sig: 'zz' }, { lease, sig: 'a'.repeat(10) }, { lease: { hostId: 'x' }, sig: 'a'.repeat(64) }]) {
      expect(await verifyLease(bad, key)).toBeNull()
    }
  })
})

describe('replication account request (#919)', () => {
  let key: CryptoKey
  beforeAll(async () => {
    key = await leaseKey('12345678', 'band-a')
  })

  it('verifies a request signed with the band key', async () => {
    const request = await signAccountRequest({ hostId: 'stage-pc', sentAt: 5 }, key)
    expect(await verifyAccountRequest(request, key)).toEqual({ hostId: 'stage-pc', sentAt: 5 })
  })

  it('refuses another key or a changed field', async () => {
    const request = await signAccountRequest({ hostId: 'stage-pc', sentAt: 5 }, key)
    expect(await verifyAccountRequest(request, await leaseKey('00000000', 'band-a'))).toBeNull()
    expect(await verifyAccountRequest({ ...request, request: { hostId: 'other', sentAt: 5 } }, key)).toBeNull()
  })

  it('a signed lease is not an account request: the two cannot be swapped', async () => {
    const lease = await signLease({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 5 }, key)
    expect(await verifyAccountRequest({ request: { hostId: 'laptop', sentAt: 5 }, sig: lease.sig }, key)).toBeNull()
  })

  it('refuses garbage instead of throwing', async () => {
    for (const bad of [null, 'x', {}, { request: { hostId: 'x', sentAt: 1 }, sig: 'zz' }]) expect(await verifyAccountRequest(bad, key)).toBeNull()
  })
})

const CODE = '57832943'
const WORKSPACE = 'leasetest'

/** What core-backend's `signLease` (Node) puts on the wire - the app must verify exactly this. */
function nodeSigned(lease: { hostId: string; epoch: number; leaseMs: number; sentAt: number }) {
  const key = createHmac('sha256', 'stageboard-host-lease').update(`${WORKSPACE}\n${CODE}`).digest()
  const payload = JSON.stringify([lease.hostId, lease.epoch, lease.leaseMs, lease.sentAt])
  return { lease, sig: createHmac('sha256', key).update(payload).digest('hex') }
}

const LEASE = { hostId: 'host-a', epoch: 1, leaseMs: 4_000, sentAt: 1_700_000_000_000 }

describe('the same wire format as a Node HMAC (#947)', () => {
  it('accepts a lease the Stage-Server signed', async () => {
    const key = await leaseKey(CODE, WORKSPACE)
    expect(await verifyLease(nodeSigned(LEASE), key)).toEqual(LEASE)
  })

  it('refuses a lease signed with another band code', async () => {
    const key = await leaseKey('11111111', WORKSPACE)
    expect(await verifyLease(nodeSigned(LEASE), key)).toBeNull()
  })

  it('refuses a changed epoch after the fact', async () => {
    const key = await leaseKey(CODE, WORKSPACE)
    const signed = nodeSigned(LEASE)
    expect(await verifyLease({ ...signed, lease: { ...LEASE, epoch: 9 } }, key)).toBeNull()
  })

  it('refuses garbage instead of throwing', async () => {
    const key = await leaseKey(CODE, WORKSPACE)
    expect(await verifyLease(null, key)).toBeNull()
    expect(await verifyLease({ lease: LEASE }, key)).toBeNull()
    expect(await verifyLease({ ...nodeSigned(LEASE), sig: 'zz' }, key)).toBeNull()
  })

  it('signs what it can verify again', async () => {
    const key = await leaseKey(CODE, WORKSPACE)
    expect(await verifyLease(await signLease(LEASE, key), key)).toEqual(LEASE)
  })
})
