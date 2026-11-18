import { HostLeaseSchema, SignedAccountRequestSchema, SignedHostLeaseSchema, type AccountRequest, type HostLease, type SignedAccountRequest, type SignedHostLease } from 'shared-types'

/**
 * The primary's alive signal on the tablet (host backup, #947, docs/25 §6e/§6g): the app verifies
 * the HMAC with WebCrypto, same payload and key derivation as core-backend's `hostLeaseAuth.ts` -
 * `HMAC(sha256, 'stageboard-host-lease', `${workspaceId}\n${accessCode}`)`, over
 * `[hostId, epoch, leaseMs, sentAt]`. Both hosts hold the band's code (the tablet learned it from
 * the primary's invite, #945), so nothing has to be distributed.
 */
const encoder = new TextEncoder()
const payload = (lease: HostLease) => JSON.stringify([lease.hostId, lease.epoch, lease.leaseMs, lease.sentAt])

const hmacKey = (raw: BufferSource, usage: KeyUsage[]) =>
  crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, true, usage)

/** The band's lease key: `HMAC(sha256, 'stageboard-host-lease', workspaceId \n accessCode)`. */
export async function leaseKey(accessCode: string, workspaceId: string): Promise<CryptoKey> {
  const base = await hmacKey(encoder.encode('stageboard-host-lease'), ['sign'])
  const key = await crypto.subtle.sign('HMAC', base, encoder.encode(`${workspaceId}\n${accessCode}`))
  return hmacKey(key, ['sign', 'verify'])
}

/** The lease when the signature matches, else null - never throws. */
export async function verifyLease(raw: unknown, key: CryptoKey): Promise<HostLease | null> {
  const parsed = SignedHostLeaseSchema.safeParse(raw)
  if (!parsed.success) return null
  const lease = HostLeaseSchema.parse(parsed.data.lease)
  const given = hexToBytes(parsed.data.sig)
  if (!given) return null
  try {
    const valid = await crypto.subtle.verify('HMAC', key, given, encoder.encode(payload(lease)))
    return valid ? lease : null
  } catch {
    return null
  }
}

/** Signs a lease - the app is the backup, the laptop signs; only used to build test messages and
 * the "take over now" self-check. */
export async function signLease(lease: HostLease, key: CryptoKey): Promise<SignedHostLease> {
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload(lease))))
  return { lease, sig: toHex(sig) }
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

const accountPayload = (request: AccountRequest) => JSON.stringify(['replication-account', request.hostId, request.sentAt])

/** The other host asking for a login to copy this band with (core-backend `signAccountRequest`). */
export async function signAccountRequest(request: AccountRequest, key: CryptoKey): Promise<SignedAccountRequest> {
  return { request, sig: toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(accountPayload(request))))) }
}

/** The request when the signature matches, else null - never throws. */
export async function verifyAccountRequest(raw: unknown, key: CryptoKey): Promise<AccountRequest | null> {
  const parsed = SignedAccountRequestSchema.safeParse(raw)
  if (!parsed.success) return null
  const given = hexToBytes(parsed.data.sig)
  if (!given) return null
  try {
    return (await crypto.subtle.verify('HMAC', key, given, encoder.encode(accountPayload(parsed.data.request)))) ? parsed.data.request : null
  } catch {
    return null
  }
}
