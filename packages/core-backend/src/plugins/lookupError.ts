import { messageFieldsOf, type ServerMessage, type ServerMessageCode, type ServerMessageParams } from 'shared-types'

/**
 * A lookup failure the musician can act on (#15): a stable `code` for the app, a German message
 * that says what happened and what to do, and the technical cause for the log. Plugins may come
 * from a separately built bundle, so the routes recognise it by shape (`lookupErrorBody`), not
 * by `instanceof`.
 */
export type LookupErrorCode = 'no-browser' | 'timeout' | 'unavailable' | 'blocked' | 'source-changed' | 'not-importable'

export class LookupError extends Error {
  readonly messageCode?: ServerMessageCode
  readonly messageParams?: ServerMessageParams
  constructor(
    readonly code: LookupErrorCode,
    /** Preferably a `serverMessage(...)`, so the device can show it in its language (#679). */
    message: ServerMessage | string,
    readonly cause?: unknown,
  ) {
    super(typeof message === 'string' ? message : message.message)
    this.name = 'LookupError'
    if (typeof message !== 'string') {
      this.messageCode = message.messageCode
      if (message.messageParams) this.messageParams = message.messageParams
    }
  }
}

/** The error body a lookup route sends: the plugin's own code and message when it threw a
 * LookupError, the raw message otherwise (code `failed`). */
export function lookupErrorBody(err: unknown): { status: 'error'; code: string } & ReturnType<typeof messageFieldsOf> {
  const code = err instanceof Error && err.name === 'LookupError' ? (err as Error & { code?: unknown }).code : undefined
  return { status: 'error', code: typeof code === 'string' ? code : 'failed', ...messageFieldsOf(err) }
}
