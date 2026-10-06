/**
 * A lookup failure the musician can act on (#15): a stable `code` for the app, a German message
 * that says what happened and what to do, and the technical cause for the log. Plugins may come
 * from a separately built bundle, so the routes recognise it by shape (`lookupErrorBody`), not
 * by `instanceof`.
 */
export type LookupErrorCode = 'no-browser' | 'timeout' | 'unavailable' | 'blocked' | 'source-changed' | 'not-importable'

export class LookupError extends Error {
  constructor(
    readonly code: LookupErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'LookupError'
  }
}

/** The error body a lookup route sends: the plugin's own code and message when it threw a
 * LookupError, the raw message otherwise (code `failed`). */
export function lookupErrorBody(err: unknown): { status: 'error'; code: string; message: string } {
  const code = err instanceof Error && err.name === 'LookupError' ? (err as Error & { code?: unknown }).code : undefined
  if (err instanceof Error && typeof code === 'string') return { status: 'error', code, message: err.message }
  return { status: 'error', code: 'failed', message: err instanceof Error ? err.message : String(err) }
}
