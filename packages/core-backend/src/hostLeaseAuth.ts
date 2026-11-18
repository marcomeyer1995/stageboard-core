import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  AccountRequestSchema,
  HostLeaseSchema,
  SignedAccountRequestSchema,
  SignedHostLeaseSchema,
  type AccountRequest,
  type HostLease,
  type SignedAccountRequest,
  type SignedHostLease,
} from 'shared-types'

/**
 * Signing the alive signal with the band code (host backup, #918, Marco 2026-11-18). Both hosts
 * hold the band's database, so both know `workspace:access`; nothing has to be distributed. Keeps
 * strangers on the network from sending a lease. Members know the code and could forge one - they
 * can press Stop on the show anyway. The code has 8 digits: the traffic must go over https to the
 * host whose fingerprint the band list names, so nobody can record a lease to guess the code from.
 */
export function leaseKey(accessCode: string, workspaceId: string): Buffer {
  return createHmac('sha256', 'stageboard-host-lease').update(`${workspaceId}\n${accessCode}`).digest()
}

const payload = (lease: HostLease) => JSON.stringify([lease.hostId, lease.epoch, lease.leaseMs, lease.sentAt])

export function signLease(lease: HostLease, key: Buffer): SignedHostLease {
  return { lease, sig: createHmac('sha256', key).update(payload(lease)).digest('hex') }
}

/** The lease when the signature matches, else null - never throws. */
export function verifyLease(raw: unknown, key: Buffer): HostLease | null {
  const parsed = SignedHostLeaseSchema.safeParse(raw)
  if (!parsed.success) return null
  const expected = createHmac('sha256', key).update(payload(HostLeaseSchema.parse(parsed.data.lease))).digest()
  const given = Buffer.from(parsed.data.sig, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected) ? parsed.data.lease : null
}

// The prefix keeps the two signatures apart: a signed lease can never pass as an account request.
const accountPayload = (request: AccountRequest) => JSON.stringify(['replication-account', request.hostId, request.sentAt])

export function signAccountRequest(request: AccountRequest, key: Buffer): SignedAccountRequest {
  return { request, sig: createHmac('sha256', key).update(accountPayload(request)).digest('hex') }
}

/** The request when the signature matches, else null - never throws. */
export function verifyAccountRequest(raw: unknown, key: Buffer): AccountRequest | null {
  const parsed = SignedAccountRequestSchema.safeParse(raw)
  if (!parsed.success) return null
  const expected = createHmac('sha256', key).update(accountPayload(AccountRequestSchema.parse(parsed.data.request))).digest()
  const given = Buffer.from(parsed.data.sig, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected) ? parsed.data.request : null
}
