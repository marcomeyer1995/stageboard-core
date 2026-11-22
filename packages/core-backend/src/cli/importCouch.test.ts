import { describe, expect, it } from 'vitest'
import { accountDocsOf, type CouchUser } from './importCouch.js'

const user = (name: string, roles: string[]): CouchUser => ({ _id: `org.couchdb.user:${name}`, name, roles, type: 'user', password_scheme: 'pbkdf2', pbkdf2_prf: 'sha256', iterations: 600000, salt: 'ab', derived_key: 'cd' })

describe('accountDocsOf (#779)', () => {
  const band = 'b-1'
  it('turns a device login into an account document with the same verifier', () => {
    const { docs } = accountDocsOf(band, [user('stageboard-b-1-anna~dev1', ['member', 'admin'])])
    expect(docs).toEqual([{ _id: 'account:stageboard-b-1-anna~dev1', name: 'stageboard-b-1-anna~dev1', roles: ['member', 'admin'], iterations: 600000, salt: 'ab', derived_key: 'cd', pbkdf2_prf: 'sha256' }])
  })
  it("turns an admin's member login (the PIN) into an anchor, and gives a plain member none", () => {
    const { docs } = accountDocsOf(band, [user('stageboard-b-1-anna', ['member', 'admin']), user('stageboard-b-1-ben', ['member'])])
    expect(docs).toEqual([{ _id: 'anchor:anna', profileId: 'anna', iterations: 600000, salt: 'ab', derived_key: 'cd', pbkdf2_prf: 'sha256' }])
  })
  it('leaves other bands, band ids that merely start the same, and users without a verifier out', () => {
    const noKey = { ...user('stageboard-b-1-x~d', ['member']), derived_key: undefined }
    const { docs, skipped } = accountDocsOf(band, [user('stageboard-b-10-anna~dev1', ['member']), user('stageboard-other-anna~d', ['member']), noKey])
    expect(docs).toEqual([])
    expect(skipped).toBe(1)
  })
})
