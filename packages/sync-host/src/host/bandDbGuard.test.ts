import { describe, expect, it } from 'vitest'
import { guardBandDb, noteBandDbLogin } from './bandDbGuard.js'
import { createPinThrottle } from './pinThrottle.js'

const basic = (username: string) => `Basic ${Buffer.from(`${username}:pw`).toString('base64')}`
const statusOf = async (path: string, authorization: string | undefined, deps = {}) => {
  const result = await guardBandDb(path, authorization, deps)
  return result.kind === 'refused' ? result.answer.status : result.kind
}

describe('guardBandDb - the one guard in front of a band database on every host (#964 step 2)', () => {
  it('lets an account of the band into its own database', async () => {
    expect(await guardBandDb('/db/stageboard-band-a/_changes?since=0', basic('stageboard-band-a-p1~dev'), {})).toEqual({ kind: 'band', db: 'stageboard-band-a', workspaceId: 'band-a', username: 'stageboard-band-a-p1~dev' })
    expect(await statusOf('/db/stageboard-band-a', basic('stageboard-band-a-p1'))).toBe('band')
    // The tablet hands the path without `/db`.
    expect(await statusOf('/stageboard-band-a/_changes', basic('stageboard-band-a-p1'))).toBe('band')
    // A document id may carry an encoded slash.
    expect(await statusOf('/db/stageboard-band-a/_local%2Fabc', basic('stageboard-band-a-p1'))).toBe('band')
  })

  it('refuses another band\'s account (403), no login (401) and a path that climbs out (403)', async () => {
    expect(await statusOf('/db/stageboard-band-a/_all_docs', basic('stageboard-band-b-p1'))).toBe(403)
    expect(await statusOf('/db/stageboard-band-a/_all_docs', undefined)).toBe(401)
    expect(await statusOf('/db//stageboard-band-a/x', basic('stageboard-band-b-p1'))).toBe(403)
    expect(await statusOf('/db/%73tageboard-band-a/x', basic('stageboard-band-b-p1'))).toBe(403)
    expect(await statusOf('/db/../stageboard-band-a', basic('stageboard-band-b-p1'))).toBe(403)
    expect(await statusOf('/db/stageboard-band-a%2Fx', basic('stageboard-band-a-p1'))).toBe(403)
  })

  it('leaves what is not a band database to the host', async () => {
    expect(await statusOf('/db/_session', undefined)).toBe('other')
    expect(await statusOf('/db/', undefined)).toBe('other')
  })

  it('answers 404 for a band this host does not host and 503 while it does not serve it - before any login', async () => {
    const deps = { servesBand: (id: string) => id !== 'joined', serving: (id: string) => id !== 'backup' }
    expect(await statusOf('/db/stageboard-joined/_changes', basic('stageboard-joined-p1'), deps)).toBe(404)
    expect(await statusOf('/db/stageboard-backup/_changes', basic('stageboard-backup-p1'), deps)).toBe(503)
    expect(await statusOf('/db/stageboard-joined/_changes', undefined, deps)).toBe(404)
    expect(await statusOf('/db/stageboard-founded/_changes', basic('stageboard-founded-p1'), deps)).toBe('band')
  })

  it('locks a login after too many wrong passwords (429 with the wait) and a good login clears the count', async () => {
    let t = 0
    const loginThrottle = createPinThrottle({ maxFailures: 3, lockoutMs: 60_000, now: () => t })
    const user = 'stageboard-band-a-p1~dev'
    noteBandDbLogin(loginThrottle, user, 401)
    noteBandDbLogin(loginThrottle, user, 401)
    noteBandDbLogin(loginThrottle, user, 200)
    noteBandDbLogin(loginThrottle, user, 401)
    noteBandDbLogin(loginThrottle, user, 401)
    expect(await statusOf('/db/stageboard-band-a', basic(user), { loginThrottle })).toBe('band')
    expect(noteBandDbLogin(loginThrottle, user, 401)).toBe(true)
    const locked = await guardBandDb('/db/stageboard-band-a', basic(user), { loginThrottle })
    expect(locked).toMatchObject({ kind: 'refused', answer: { status: 429, body: { error: 'locked', retryAfterSeconds: 60 } } })
    // Another device of the band is not locked.
    expect(await statusOf('/db/stageboard-band-a', basic('stageboard-band-a-p1~other'), { loginThrottle })).toBe('band')
    t = 61_000
    expect(await statusOf('/db/stageboard-band-a', basic(user), { loginThrottle })).toBe('band')
  })
})
