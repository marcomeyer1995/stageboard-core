import type { HostRequestDeps, HostRequest, HostAnswer } from 'sync-host'

/** The tablet's names for the shared request handler (sync-host/hostRequest.ts, #964): the app's request and deps ARE the shared ones. */
export type AppHostRequest = HostRequest
export type AppHostAnswer = HostAnswer
export type AppHostDeps = HostRequestDeps
export { answerHostRequest, bandOfPath, loginCheckOf } from 'sync-host'

/**
 * An answer that says the database connection behind it is closed (#962): the browser closes an IndexedDB connection on its own
 * (storage pressure, the page being frozen) and PouchDB then fails every request on that handle with "The database connection is
 * closing" - for good, until a new handle is opened. The tablet host drops its cached handles and tries once more.
 */
export function isClosedConnection(answer: { status: number; body?: unknown }): boolean {
  if (answer.status !== 500) return false
  const text = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body ?? '')
  return /InvalidStateError/.test(text) && /connection is closing|connection is closed|database is closed/i.test(text)
}
