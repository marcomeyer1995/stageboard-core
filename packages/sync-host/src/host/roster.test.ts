import { describe, expect, it } from 'vitest'
import { rosterOfProfileDocs } from './roster.js'

describe('the roster a joining device sees', () => {
  it('is every profile of the band as just enough to render a picker: id, name, whether an admin', () => {
    expect(
      rosterOfProfileDocs([
        { _id: 'profiles:a', id: 'a', name: 'Anna', stageRoles: ['admin', 'vocals'] },
        { _id: 'profiles:b', id: 'b', name: 'Ben', stageRoles: ['drums'] },
        { _id: 'profiles:c', id: 'c', name: 'Cleo' },
      ]),
    ).toEqual([
      { profileId: 'a', name: 'Anna', isAdmin: true },
      { profileId: 'b', name: 'Ben', isAdmin: false },
      { profileId: 'c', name: 'Cleo', isAdmin: false },
    ])
  })

  it('never carries anything else of the profile - no credentials, no roles', () => {
    const [entry] = rosterOfProfileDocs([{ _id: 'profiles:a', id: 'a', name: 'Anna', stageRoles: ['admin'], pin: '1234', password: 'x' }])
    expect(Object.keys(entry!).sort()).toEqual(['isAdmin', 'name', 'profileId'])
  })

  it('skips documents that are no profile or have no id or name, instead of showing a nameless entry', () => {
    expect(
      rosterOfProfileDocs([
        { _id: 'songs:x', id: 'x', name: 'Song' },
        { _id: 'profiles:a', name: 'No id' },
        { _id: 'profiles:b', id: 'b' },
        { _id: 'profiles:c', id: 'c', name: '' },
        { _id: 'profiles:d', id: 'd', name: 'Dora' },
      ]),
    ).toEqual([{ profileId: 'd', name: 'Dora', isAdmin: false }])
  })
})
