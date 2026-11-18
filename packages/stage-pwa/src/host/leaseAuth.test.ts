import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { leaseKey, signLease, verifyLease } from './leaseAuth'

const CODE = '57832943'
const WORKSPACE = 'leasetest'

/** What core-backend's `signLease` (Node) puts on the wire - the app must verify exactly this. */
function nodeSigned(lease: { hostId: string; epoch: number; leaseMs: number; sentAt: number }) {
  const key = createHmac('sha256', 'stageboard-host-lease').update(`${WORKSPACE}\n${CODE}`).digest()
  const payload = JSON.stringify([lease.hostId, lease.epoch, lease.leaseMs, lease.sentAt])
  return { lease, sig: createHmac('sha256', key).update(payload).digest('hex') }
}

const LEASE = { hostId: 'host-a', epoch: 1, leaseMs: 4_000, sentAt: 1_700_000_000_000 }

describe('lease signature on the tablet (#947)', () => {
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
