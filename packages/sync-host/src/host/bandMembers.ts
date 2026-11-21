import type { ActivateProfileRequest, CreateMemberRequest, RemoveMemberRequest, ResetMemberPasswordRequest, SetMemberAdminRequest, SetOwnPinRequest } from 'shared-types'
import { deviceUsername, memberUsername, workspaceDbName, type BandAccounts } from './bandAccounts.js'
import type { BandJoin, BandJoinDeps, BandJoinResponse } from './bandJoin.js'
import type { PinThrottle } from './pinThrottle.js'

/**
 * Managing the members of a band (host module, #960): adding and removing people, giving and taking admin,
 * choosing or resetting a PIN, and a device taking on another person - the rules of the Host's member
 * routes, once, for every host. Every change needs an admin of *this* band (a device login with the admin role);
 * wrong tries are counted per login name, so the admin routes cannot be used to guess a password.
 */
export interface BandMembersDeps extends Pick<BandJoinDeps, 'accounts' | 'workspaceId' | 'profile'> {
  join: BandJoin
  /** The profile ids the roster lists as admin - what "at least one admin must remain" counts. */
  adminProfileIds: () => Promise<string[]>
  /** Wrong tries of an admin login, per login name. */
  loginThrottle: PinThrottle
}

export interface BandMembers {
  create(request: CreateMemberRequest): Promise<BandJoinResponse>
  setAdmin(profileId: string, request: SetMemberAdminRequest): Promise<BandJoinResponse>
  remove(profileId: string, request: RemoveMemberRequest): Promise<BandJoinResponse>
  /** Gives another admin a fresh 4-digit PIN to read out. */
  resetPin(profileId: string, request: ResetMemberPasswordRequest): Promise<BandJoinResponse>
  /** An admin choosing their own PIN, from their own device. */
  setOwnPin(profileId: string, request: SetOwnPinRequest): Promise<BandJoinResponse>
  /** A device that is signed in to the band taking on another person (or re-picking its own). */
  activate(profileId: string, request: ActivateProfileRequest): Promise<BandJoinResponse>
}

const error = (status: number, message: string): BandJoinResponse => ({ status, body: { status: 'error', message } })
const basic = (user: string, password: string) => `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${password}`)))}`
const randomPin = (): string => String(crypto.getRandomValues(new Uint32Array(1))[0]! % 10_000).padStart(4, '0')
const randomSecret = (): string => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/[+/=]/g, '')

export function createBandMembers(deps: BandMembersDeps): BandMembers {
  const { accounts, join, loginThrottle } = deps
  const workspaceId = deps.workspaceId ?? ''
  const prefix = `${workspaceDbName(workspaceId)}-`
  /** The profile a login belongs to: `<band>-<profileId>` or `<band>-<profileId>~<deviceId>`. */
  const profileOf = (username: string) => username.slice(prefix.length).split('~')[0] ?? ''

  /** The login of a device of this band, or null - wrong tries counted per name. */
  const signedIn = async (username: string, password: string) => {
    if (!username.startsWith(prefix)) return null
    if (loginThrottle.lockedForSeconds(username) > 0) return null
    const ctx = await accounts.login(basic(username, password))
    if (ctx) loginThrottle.recordSuccess(username)
    else loginThrottle.recordFailure(username)
    return ctx
  }
  const asAdmin = async (username: string, password: string) => {
    const ctx = await signedIn(username, password)
    return ctx?.roles.includes('admin') ? ctx : null
  }
  const notAdmin = () => error(403, "Not this workspace's admin")

  return {
    async create(request) {
      if (!(await asAdmin(request.adminUsername, request.adminPassword))) return notAdmin()
      const username = memberUsername(workspaceId, request.profileId)
      if (!request.isAdmin) return { status: 201, body: { username, password: request.password ?? randomSecret() } }
      if (request.password !== undefined && !/^\d{4}$/.test(request.password)) return error(400, 'An admin PIN is exactly 4 digits')
      const pin = request.password ?? randomPin()
      await accounts.setPin(request.profileId, pin)
      return { status: 201, body: { username, password: pin } }
    },

    async setAdmin(profileId, request) {
      if (!(await asAdmin(request.adminUsername, request.adminPassword))) return notAdmin()
      if (!request.isAdmin && (await deps.adminProfileIds()).filter((id) => id !== profileId).length === 0) return error(400, 'At least one admin must remain')
      // No admin takes away their own rights - only another admin can.
      if (!request.isAdmin && profileOf(request.adminUsername) === profileId) return error(400, 'An admin cannot revoke their own admin rights')
      await accounts.setAdmin(profileId, request.isAdmin)
      return { status: 204, body: undefined }
    },

    async remove(profileId, request) {
      if (!(await asAdmin(request.adminUsername, request.adminPassword))) return notAdmin()
      if (profileOf(request.adminUsername) === profileId) return error(400, 'An admin cannot remove their own profile')
      if ((await deps.adminProfileIds()).filter((id) => id !== profileId).length === 0) return error(400, 'At least one admin must remain')
      await accounts.removeMember(profileId)
      return { status: 204, body: undefined }
    },

    async resetPin(profileId, request) {
      if (!(await asAdmin(request.adminUsername, request.adminPassword))) return notAdmin()
      const profile = await deps.profile(profileId)
      if (!profile) return error(404, 'Unknown roster member')
      if (!(profile.stageRoles ?? []).includes('admin')) return error(400, 'Only admin accounts have a PIN to reset')
      const pin = randomPin()
      await accounts.setPin(profileId, pin)
      return { status: 200, body: { username: memberUsername(workspaceId, profileId), password: pin } }
    },

    async setOwnPin(profileId, request) {
      if (profileOf(request.callerUsername) !== profileId || !request.callerUsername.startsWith(prefix)) return error(403, 'Can only set your own PIN')
      const caller = await asAdmin(request.callerUsername, request.callerPassword)
      if (!caller) return error(403, 'Invalid credentials or not an admin account')
      await accounts.setPin(profileId, request.newPin)
      // The device's own login is reissued, never a shared one - so every other device keeps its own.
      const credentials = await accounts.provisionDevice(profileId, request.deviceId, true)
      return { status: 200, body: { ...credentials, isAdmin: true } }
    },

    async activate(profileId, request) {
      if (!request.callerUsername.startsWith(prefix)) return error(403, 'Caller is not a member of this workspace')
      const caller = await signedIn(request.callerUsername, request.callerPassword)
      if (!caller) return error(403, 'Invalid caller credentials')
      // Re-picking this device's own current person: nothing changes (a new password would lock the device out of what it holds).
      if (request.callerUsername === deviceUsername(workspaceId, profileId, request.deviceId)) {
        return { status: 200, body: { username: request.callerUsername, password: request.callerPassword, isAdmin: caller.roles.includes('admin') } }
      }
      return join.become(profileId, request.deviceId, request.password)
    },
  }
}
