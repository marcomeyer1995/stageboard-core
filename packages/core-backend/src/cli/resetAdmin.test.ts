import { describe, expect, it } from 'vitest'
import { findBand, findMember, parseArgs, type Member } from './resetAdmin.js'

const bands = [
  { workspaceId: 'b1', workspaceName: 'Abadschendaler' },
  { workspaceId: 'b2', workspaceName: 'SOAT' },
]
const members: Member[] = [
  { profileId: 'p1', name: 'Marco', isAdmin: true },
  { profileId: 'p2', name: 'Caro', isAdmin: false },
  { profileId: 'p3', name: 'Kai', isAdmin: false },
  { profileId: 'p4', name: 'Kai', isAdmin: false },
]

describe('admin:reset (#70)', () => {
  it('reads what is asked: bands, members, or a reset', () => {
    expect(parseArgs([])).toEqual({ kind: 'bands' })
    expect(parseArgs(['SOAT'])).toEqual({ kind: 'members', band: 'SOAT' })
    expect(parseArgs(['b1', 'Marco'])).toEqual({ kind: 'reset', band: 'b1', member: 'Marco', makeAdmin: false })
    expect(parseArgs(['b1', 'Caro', '--make-admin'])).toEqual({ kind: 'reset', band: 'b1', member: 'Caro', makeAdmin: true })
  })

  it('finds a band by id or exact name', () => {
    expect(findBand(bands, 'b2')).toEqual(bands[1])
    expect(findBand(bands, 'Abadschendaler')).toEqual(bands[0])
    expect(findBand(bands, 'abadschendaler')).toMatch(/Keine Band/)
  })

  it('finds an admin by id or name, any case', () => {
    expect(findMember(members, 'p1', false)).toEqual(members[0])
    expect(findMember(members, 'marco', false)).toEqual(members[0])
  })

  it('a non-admin only with --make-admin', () => {
    expect(findMember(members, 'Caro', false)).toMatch(/kein Admin.*--make-admin/)
    expect(findMember(members, 'Caro', true)).toEqual(members[1])
  })

  it('unknown or ambiguous names say what to do', () => {
    expect(findMember(members, 'Nobody', true)).toMatch(/Kein Mitglied/)
    expect(findMember(members, 'Kai', true)).toMatch(/Mehrere.*ID/)
    expect(findMember(members, 'p4', true)).toEqual(members[3])
  })
})
