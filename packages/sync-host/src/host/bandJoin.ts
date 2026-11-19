import type { JoinAsMemberRequest, VerifyAdminPinRequest } from 'shared-types'
import type { BandAccounts } from './bandAccounts.js'
import type { PinThrottle } from './pinThrottle.js'

/**
 * Becoming a member of the band and proving an admin PIN (host module, #960) - the rules of the Stage-Server's
 * `join` and `verify-admin-pin` routes, once, for every host. A non-admin gets a device login without any
 * password; an admin needs the PIN (the first time: chooses one), or the last 4 digits of the band code - the
 * recovery way in, which every device that knows the code has. One count of wrong PINs per person guards both
 * the join and the check, so the two cannot each give a fresh set of guesses.
 */
export interface BandJoinDeps {
  accounts: BandAccounts
  throttle: PinThrottle
  /** The band's standing access code, or null for a band this host does not hold. */
  accessCode: () => Promise<string | null>
  /** The person's profile document of the band, or null. */
  profile: (profileId: string) => Promise<{ stageRoles?: string[] } | null>
  /** The band's id, to key the PIN count (one host may hold several bands). Defaults to ''. */
  workspaceId?: string
}

export interface BandJoinResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

export interface BandJoin {
  join(profileId: string, request: Pick<JoinAsMemberRequest, 'code' | 'password' | 'deviceId'>): Promise<BandJoinResponse>
  /** The decision both `join` (proof: the band code) and a device re-picking a person (proof: its own login) share:
   * a non-admin gets a device login; an admin needs the PIN (the first time: chooses one) or the recovery suffix. */
  become(profileId: string, deviceId: string, password: string | undefined): Promise<BandJoinResponse>
  verifyPin(request: VerifyAdminPinRequest): Promise<BandJoinResponse>
}

const error = (status: number, message: string): BandJoinResponse => ({ status, body: { status: 'error', message } })

export function createBandJoin(deps: BandJoinDeps): BandJoin {
  const { accounts, throttle } = deps
  const keyOf = (profileId: string) => `${deps.workspaceId ?? ''}:${profileId}`
  const locked = (seconds: number): BandJoinResponse => ({
    status: 429,
    headers: { 'Retry-After': String(seconds) },
    body: { status: 'error', message: 'Too many wrong PINs - try again later', retryAfterSeconds: seconds },
  })

  /** Counts the try; true when it is right. */
  const tryPin = async (profileId: string, pin: string, suffix: string): Promise<boolean> => {
    const key = keyOf(profileId)
    const right = pin === suffix || (await accounts.checkPin(profileId, pin))
    if (right) throttle.recordSuccess(key)
    else throttle.recordFailure(key)
    return right
  }

  const api: BandJoin = {
    async join(profileId, request) {
      const code = await deps.accessCode()
      if (!code || request.code !== code) return error(403, 'Wrong code')
      return api.become(profileId, request.deviceId, request.password)
    },

    async become(profileId, deviceId, password) {
      const code = await deps.accessCode()
      if (!code) return error(403, 'Wrong code')
      const profile = await deps.profile(profileId)
      if (!profile) return error(404, 'Unknown roster member')

      if (!(profile.stageRoles ?? []).includes('admin')) {
        const known = await accounts.knownMember(profileId)
        const credentials = await accounts.provisionDevice(profileId, deviceId, false)
        return { status: known ? 200 : 201, body: { ...credentials, isAdmin: false } }
      }

      if (!(await accounts.hasPin(profileId))) {
        if (!password || !/^\d{4}$/.test(password)) return error(400, 'Admin accounts need a 4-digit PIN')
        await accounts.setPin(profileId, password)
        const credentials = await accounts.provisionDevice(profileId, deviceId, true)
        return { status: 201, body: { ...credentials, isAdmin: true } }
      }
      if (!password) return error(403, 'Admin accounts require a code')
      const wait = throttle.lockedForSeconds(keyOf(profileId))
      if (wait > 0) return locked(wait)
      if (!(await tryPin(profileId, password, code.slice(-4)))) return error(403, 'Wrong code')
      const credentials = await accounts.provisionDevice(profileId, deviceId, true)
      return { status: 200, body: { ...credentials, isAdmin: true } }
    },

    async verifyPin(request) {
      const wait = throttle.lockedForSeconds(keyOf(request.profileId))
      if (wait > 0) return locked(wait)
      const code = await deps.accessCode()
      const profile = await deps.profile(request.profileId)
      if (!code || !profile || !(profile.stageRoles ?? []).includes('admin')) return error(403, 'Wrong admin or PIN')
      return (await tryPin(request.profileId, request.pin, code.slice(-4))) ? { status: 200, body: { status: 'ok' } } : error(403, 'Wrong admin or PIN')
    },
  }
  return api
}
