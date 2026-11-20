import {
  ForgetDeviceRequestSchema,
  GetAccessCodeRequestSchema,
  RenameWorkspaceRequestSchema,
  RevokeDeviceRequestSchema,
  RotateAccessCodeRequestSchema,
  SetMasterModeRequestSchema,
  WorkspaceDeleteRequestSchema,
  WorkspaceProvisionRequestSchema,
} from 'shared-types'
import type { BandCatalog } from './bandCatalog.js'
import type { HostRoute, HostRouteResponse } from './routes.js'

/**
 * The band life cycle as routes of the shared host table (#962). The rules are `createBandCatalog`'s; a host that
 * does not hold bands (or answers them itself) simply does not add these.
 */

/** `decodeURIComponent` that gives "" instead of throwing - an undecodable id is simply not a safe one. */
const safeDecode = (part: string): string => {
  try {
    return decodeURIComponent(part)
  } catch {
    return ''
  }
}

const answer = (value: { status: number; body?: unknown }): HostRouteResponse => (value.body === undefined ? { status: value.status } : { status: value.status, body: value.body })

export function createBandRoutes(bands: BandCatalog): HostRoute[] {
  const route = (method: HostRoute['method'], pattern: string, handle: (request: Parameters<HostRoute['handle']>[0]) => Promise<HostRouteResponse>): HostRoute => ({ method, pattern, handle })

  return [
    route('POST', '/workspaces', async (request) => {
      const parsed = WorkspaceProvisionRequestSchema.safeParse(request.body)
      if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
      return answer(await bands.create(parsed.data, request.remoteAddress))
    }),
    route('GET', '/workspaces', async () => answer(await bands.list())),
    route('DELETE', '/workspaces/:workspaceId', async (request) => {
      const parsed = WorkspaceDeleteRequestSchema.safeParse(request.body)
      if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
      return answer(await bands.remove(safeDecode(request.params.workspaceId ?? ''), parsed.data))
    }),
    route('POST', '/workspaces/:workspaceId/access-code', async (request) => {
      const parsed = GetAccessCodeRequestSchema.safeParse(request.body)
      if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
      return answer(await bands.accessCode(safeDecode(request.params.workspaceId ?? ''), parsed.data))
    }),
    route('POST', '/workspaces/:workspaceId/access-code/rotate', async (request) => {
      const parsed = RotateAccessCodeRequestSchema.safeParse(request.body)
      if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
      return answer(await bands.rotateAccessCode(safeDecode(request.params.workspaceId ?? ''), parsed.data))
    }),
    route('POST', '/workspaces/:workspaceId/name', async (request) => {
      const parsed = RenameWorkspaceRequestSchema.safeParse(request.body)
      if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
      return answer(await bands.rename(safeDecode(request.params.workspaceId ?? ''), parsed.data))
    }),
    route('POST', '/workspaces/:workspaceId/master-mode', async (request) => {
      const parsed = SetMasterModeRequestSchema.safeParse(request.body)
      if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
      return answer(await bands.setMasterMode(safeDecode(request.params.workspaceId ?? ''), parsed.data))
    }),
    route('POST', '/workspaces/:workspaceId/devices/:deviceId/revoke', async (request) => {
      const parsed = RevokeDeviceRequestSchema.safeParse(request.body)
      if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
      return answer(await bands.revokeDevice(safeDecode(request.params.workspaceId ?? ''), { ...parsed.data, deviceId: safeDecode(request.params.deviceId ?? '') }))
    }),
    route('POST', '/workspaces/:workspaceId/devices/:deviceId/forget', async (request) => {
      const parsed = ForgetDeviceRequestSchema.safeParse(request.body)
      if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
      return answer(await bands.forgetDevice(safeDecode(request.params.workspaceId ?? ''), { ...parsed.data, deviceId: safeDecode(request.params.deviceId ?? '') }))
    }),
  ]
}
