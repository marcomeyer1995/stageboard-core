import type { DatabaseHostRequest } from 'sync-host/database-host'
import type { HostDatabaseRequest, SyncResponse } from 'sync-host'

/**
 * What devices reach at `/db/...` (#964): the band databases, answered by the host's own database host **in this process** - the same
 * function the host's admin client reaches over HTTP, so no second server and no proxy sits in between. The guard in front of it is the
 * one every host has (`guardBandDb` in the host pipeline, #964 step 2); this only hands the request over in the shape the database host
 * takes.
 */
export function laptopDatabase(handle: (request: DatabaseHostRequest) => Promise<SyncResponse>): (request: HostDatabaseRequest) => Promise<SyncResponse> {
  return (request) => {
    // A JSON body arrives parsed; anything else (an attachment) as the bytes with its type - the shape the database host takes.
    const contentType = request.contentType ?? ''
    const raw = request.body
    const body = raw === undefined || raw === null ? undefined : Buffer.isBuffer(raw) ? (raw.length === 0 ? undefined : contentType.includes('json') || contentType === '' ? safeJson(raw) : { data: new Uint8Array(raw), contentType }) : raw
    return handle({
      method: request.method,
      path: request.path,
      query: request.query,
      body,
      authorization: request.authorization,
      ...(request.signal ? { signal: request.signal } : {}),
    })
  }
}

const safeJson = (raw: Buffer): unknown => {
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    return undefined
  }
}
