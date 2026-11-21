import { SERVER_MESSAGES_DE, type HostMessageCode } from 'shared-types'
import i18n from '../i18n'

/** What a Host reply or result may carry (#679, shared-types hostMessage.ts). */
export type ServerMessageFields = { message?: string; messageCode?: string; messageParams?: Record<string, string | number> } | null | undefined

/**
 * The server's message in this device's language: its code translated (`server.json`) when this
 * app knows the code, else the host's own text - a newer host's code an older app can't know
 * still shows something, in German.
 */
export function hostText(fields: ServerMessageFields): string | undefined {
  const code = fields?.messageCode
  if (code && code in SERVER_MESSAGES_DE) return i18n.t(`server:${code as HostMessageCode}`, fields?.messageParams ?? {})
  return fields?.message
}

/** `hostText` for a job's or status's `error` (`error`, `errorCode`, `errorParams`). */
export function hostErrorText(fields: { error?: string; errorCode?: string; errorParams?: Record<string, string | number> } | null | undefined): string | undefined {
  return hostText(fields ? { message: fields.error, messageCode: fields.errorCode, messageParams: fields.errorParams } : null)
}
