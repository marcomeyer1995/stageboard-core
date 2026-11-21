import { messageFieldsOf } from 'shared-types'

/** A lookup failure the musician can act on (#15): a stable `code` the app tells apart (`blocked`, `timeout`, ...) and the words the add-on wrote for it. The routes recognise it by shape (`lookupErrorBody`), not by `instanceof`. */
export class LookupError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'LookupError'
  }
}

/** The error body a lookup route sends: the plugin's own code and message when it threw a
 * LookupError, the raw message otherwise (code `failed`). */
export function lookupErrorBody(err: unknown): { status: 'error'; code: string } & ReturnType<typeof messageFieldsOf> {
  const code = err instanceof Error && err.name === 'LookupError' ? (err as Error & { code?: unknown }).code : undefined
  return { status: 'error', code: typeof code === 'string' ? code : 'failed', ...messageFieldsOf(err) }
}
