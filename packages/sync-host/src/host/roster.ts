import type { RosterMember } from 'shared-types'

/**
 * The roster a device sees while it joins (host module, #949): every profile of the band as just enough to render a
 * "who are you" picker - id, name, whether an admin - and nothing else (no credentials, no roles). Both hosts read
 * the band's `profiles:*` documents their own way (the Host from CouchDB, the tablet from its PouchDB); this
 * is what they make of them.
 */
export function rosterOfProfileDocs(docs: readonly Record<string, unknown>[]): RosterMember[] {
  const members: RosterMember[] = []
  for (const doc of docs) {
    if (typeof doc._id !== 'string' || !doc._id.startsWith('profiles:')) continue
    if (typeof doc.id !== 'string' || doc.id === '' || typeof doc.name !== 'string' || doc.name === '') continue
    const roles = Array.isArray(doc.stageRoles) ? doc.stageRoles : []
    members.push({ profileId: doc.id, name: doc.name, isAdmin: roles.includes('admin') })
  }
  return members
}
