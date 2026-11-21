import { describe, expect, it } from 'vitest'
import { JOB_ROUTES, refusalFor } from 'sync-host'
import { createTabletCapabilities } from './tabletCapabilities'
import { isClosedConnection } from './hostHttp'

describe('what the tablet cannot do (#962)', () => {
  it('refuses every job of the shared table with 501 and what it lacks - never 404 (the handler itself is tested in sync-host)', () => {
    const caps = createTabletCapabilities({ platform: 'android', cpuCores: 8 })
    for (const route of JOB_ROUTES) {
      const path = route.pattern.replace(/:([a-zA-Z]+)/g, (_m, name) => (name === 'name' ? 'stem-separation' : 'x'))
      const refused = refusalFor(caps, route.method, path)
      expect(refused?.status, `${route.method} ${route.pattern}`).toBe(501)
      expect(refused?.body).toMatchObject({ error: 'capability_missing' })
    }
  })
})

describe('isClosedConnection (#962)', () => {
  it('recognises the answer of a database handle whose connection the browser closed', () => {
    const closed = { status: 500, body: { error: "InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.", status: 500 } }
    expect(isClosedConnection(closed)).toBe(true)
    expect(isClosedConnection({ status: 500, body: 'InvalidStateError: the database connection is closed' })).toBe(true)
  })

  it('is false for every other answer - a real error must not be retried', () => {
    expect(isClosedConnection({ status: 200, body: { error: 'InvalidStateError: connection is closing' } })).toBe(false)
    expect(isClosedConnection({ status: 500, body: { error: 'QuotaExceededError' } })).toBe(false)
    expect(isClosedConnection({ status: 500, body: null })).toBe(false)
  })
})
