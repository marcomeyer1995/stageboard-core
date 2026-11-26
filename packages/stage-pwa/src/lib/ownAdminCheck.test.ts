import { describe, expect, it } from 'vitest'
import { ownAdminCheckFor } from './ownAdminCheck'

const login = { id: 'band', username: 'stageboard-band-ben~ben-tab', password: 'secret', isAdmin: false }
const ben = (admin: boolean) => ({ id: 'ben', stageRoles: admin ? ['drums', 'admin'] : ['drums'] })

describe('this device learns admin rights another admin gave or took (#978)', () => {
  it('asks the host when the roster and the device disagree - promoted or demoted', () => {
    expect(ownAdminCheckFor(login, ben(true))).toBe('ben')
    expect(ownAdminCheckFor({ ...login, isAdmin: true }, ben(false))).toBe('ben')
  })

  it('stays quiet when they agree', () => {
    expect(ownAdminCheckFor(login, ben(false))).toBeNull()
    expect(ownAdminCheckFor({ ...login, isAdmin: true }, ben(true))).toBeNull()
  })

  it('never for a person this device is not signed in as - re-picking them would take them on', () => {
    expect(ownAdminCheckFor(login, { id: 'anna', stageRoles: ['admin'] })).toBeNull()
    expect(ownAdminCheckFor(login, { id: 'be', stageRoles: ['admin'] })).toBeNull()
  })

  it('also for a login without a device part, and never without a login or a person', () => {
    expect(ownAdminCheckFor({ ...login, username: 'stageboard-band-ben' }, ben(true))).toBe('ben')
    expect(ownAdminCheckFor({ ...login, username: undefined }, ben(true))).toBeNull()
    expect(ownAdminCheckFor(login, undefined)).toBeNull()
    expect(ownAdminCheckFor(undefined, ben(true))).toBeNull()
  })
})
