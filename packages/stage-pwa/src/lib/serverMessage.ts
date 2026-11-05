import { SERVER_MESSAGES_DE, type ServerMessageCode } from 'shared-types'
import i18n from '../i18n'

/** What a Stage-Server reply or result may carry (#679, shared-types serverMessage.ts). */
export type ServerMessageFields = { message?: string; messageCode?: string; messageParams?: Record<string, string | number> } | null | undefined

/**
 * The server's message in this device's language: its code translated (`server.json`) when this
 * app knows the code, else the server's own text - a newer server's code an older app can't know
 * still shows something, in German.
 */
export function serverText(fields: ServerMessageFields): string | undefined {
  const code = fields?.messageCode
  if (code && code in SERVER_MESSAGES_DE) return i18n.t(`server:${code as ServerMessageCode}`, fields?.messageParams ?? {})
  return fields?.message
}

/** `serverText` for a job's or status's `error` (`error`, `errorCode`, `errorParams`). */
export function serverErrorText(fields: { error?: string; errorCode?: string; errorParams?: Record<string, string | number> } | null | undefined): string | undefined {
  return serverText(fields ? { message: fields.error, messageCode: fields.errorCode, messageParams: fields.errorParams } : null)
}
