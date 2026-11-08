import type { SyncDatabase, SyncRequest, SyncResponse } from './index.js'

/**
 * A band's write rules on any host (docs/25): every write - a single document, a deletion, an
 * attachment, and what arrives by replication (`_bulk_docs`) - first goes through the band's
 * `validate_doc_update` functions (`_design/roster`: only an admin edits the roster, only the
 * Stage-Server writes `host-accounts`, …), the way CouchDB does it. Used by couch-host (laptop)
 * and by the Android host, which has no CouchDB in front of its database.
 */
export interface UserCtx {
  name: string | null
  roles: string[]
}

export interface SecurityDoc {
  admins?: { names?: string[]; roles?: string[] }
  members?: { names?: string[]; roles?: string[] }
}

export function inList(ctx: UserCtx, list: { names?: string[]; roles?: string[] } | undefined): boolean {
  if (!list) return false
  return (ctx.name !== null && (list.names ?? []).includes(ctx.name)) || (list.roles ?? []).some((r) => ctx.roles.includes(r))
}

export const isServerAdmin = (ctx: UserCtx) => ctx.roles.includes('_admin')

/** A validate_doc_update function from a design document - written only by admins. */
type Validator = (newDoc: unknown, oldDoc: unknown, userCtx: UserCtx, secObj: SecurityDoc) => void
const compiled = new Map<string, Validator>()
function compile(source: string): Validator {
  let fn = compiled.get(source)
  if (!fn) {
    fn = new Function(`return (${source})`)() as Validator
    compiled.set(source, fn)
  }
  return fn
}

export interface WriteGuardOptions {
  open: (name: string) => SyncDatabase | null
  security: (name: string) => Promise<SecurityDoc>
}

type Refusal = { id: string; error: string; reason: string }

const json = (status: number, body: unknown): SyncResponse => ({ status, body })

export function createWriteGuard(options: WriteGuardOptions) {
  /** The band's validators against each incoming document; a refused one comes back as an error row. */
  const validate = async (name: string, ctx: UserCtx, docs: Record<string, unknown>[]): Promise<{ ok: Record<string, unknown>[]; refused: Refusal[] }> => {
    if (isServerAdmin(ctx)) return { ok: docs, refused: [] }
    const store = options.open(name)
    if (!store) return { ok: [], refused: docs.map((d) => ({ id: String(d._id), error: 'not_found', reason: 'Database does not exist.' })) }
    const designs = await store.allDocs({ startkey: '_design/', endkey: '_design/￿', include_docs: true })
    const validators = designs.rows.flatMap((r) => {
      const source = (r.doc as { validate_doc_update?: string } | undefined)?.validate_doc_update
      return source ? [compile(source)] : []
    })
    const sec = await options.security(name)
    const dbAdmin = inList(ctx, sec.admins)
    const ok: Record<string, unknown>[] = []
    const refused: Refusal[] = []
    for (const doc of docs) {
      const id = String(doc._id)
      if (id.startsWith('_design/') && !dbAdmin) {
        refused.push({ id, error: 'unauthorized', reason: 'Only admins may write design documents.' })
        continue
      }
      const oldDoc = await store.get(id).catch(() => null)
      try {
        for (const v of validators) v(doc, oldDoc, ctx, sec)
        ok.push(doc)
      } catch (thrown) {
        const t = thrown as { forbidden?: string; unauthorized?: string }
        refused.push({ id, error: t.unauthorized ? 'unauthorized' : 'forbidden', reason: t.forbidden ?? t.unauthorized ?? String(thrown) })
      }
    }
    return { ok, refused }
  }

  const refusal = (r: Refusal): SyncResponse => json(r.error === 'unauthorized' ? 401 : 403, { error: r.error, reason: r.reason })

  /** Checks the writes in `request` (path `/<db>/…`) and hands what may be written to `pass`. */
  return async (ctx: UserCtx, request: SyncRequest, pass: (request: SyncRequest) => Promise<SyncResponse>): Promise<SyncResponse> => {
    const method = request.method.toUpperCase()
    const parts = request.path.split('/').filter((p) => p !== '')
    const [first, second] = parts
    if (first === undefined || second === undefined) return pass(request)
    const name = decodeURIComponent(first)

    if (method === 'POST' && second === '_bulk_docs') {
      const body = request.body as { docs: Record<string, unknown>[]; new_edits?: boolean }
      const { ok, refused } = await validate(name, ctx, body.docs)
      const written = ok.length > 0 ? ((await pass({ ...request, body: { ...body, docs: ok } })).body as unknown[]) : []
      return json(201, [...written, ...refused])
    }
    if ((method === 'PUT' || method === 'DELETE') && !second.startsWith('_')) {
      const id = decodeURIComponent(second)
      let doc: Record<string, unknown>
      if (parts.length === 2) {
        doc = method === 'DELETE' ? { _id: id, _rev: request.query.rev, _deleted: true } : { ...(request.body as object), _id: id }
      } else {
        // An attachment changes its document - the rules see the document as it is.
        const current = ((await options.open(name)?.get(id).catch(() => null)) ?? { _id: id }) as Record<string, unknown>
        doc = { ...current, _id: id, ...(request.query.rev ? { _rev: request.query.rev } : {}) }
      }
      const { refused } = await validate(name, ctx, [doc])
      if (refused[0]) return refusal(refused[0])
    }
    if ((method === 'PUT' || method === 'DELETE') && (second === '_design' || second.startsWith('_design/')) && parts.length >= 2) {
      const id = second === '_design' ? `_design/${decodeURIComponent(parts[2] ?? '')}` : decodeURIComponent(second)
      const { refused } = await validate(name, ctx, [{ ...(method === 'PUT' ? (request.body as object) : { _deleted: true }), _id: id }])
      if (refused[0]) return refusal(refused[0])
    }
    return pass(request)
  }
}
