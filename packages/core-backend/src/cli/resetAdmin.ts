/**
 * Server-local admin recovery (#70 break-glass): when no admin can get into a band any more -
 * every device's login gone at once, nobody left to press "Passwort zurücksetzen" in the app.
 * Runs on the Stage-Server itself with the server's own CouchDB login (serviceEnv.ts), adds no
 * network route and no client-visible secret: only someone with a shell on the server can use it.
 *
 *   npm run admin:reset -w core-backend                                  # list bands
 *   npm run admin:reset -w core-backend -- <band>                        # list its members
 *   npm run admin:reset -w core-backend -- <band> <member>               # fresh PIN for an admin
 *   npm run admin:reset -w core-backend -- <band> <member> --make-admin  # …and make them admin
 *
 * <band> is the band's id or exact name, <member> the profile id or the name as in the roster
 * (case-insensitive). The new 4-digit PIN is printed once - like "Passwort zurücksetzen" in the app.
 */
import { pathToFileURL } from 'node:url'
import { serverCouchConfig } from './serviceEnv.js'

export interface Band {
  workspaceId: string
  workspaceName: string
}

export interface Member {
  profileId: string
  name: string
  isAdmin: boolean
}

export type Request =
  | { kind: 'bands' }
  | { kind: 'members'; band: string }
  | { kind: 'reset'; band: string; member: string; makeAdmin: boolean }

/** What the arguments ask for (no lookups yet). */
export function parseArgs(args: string[]): Request {
  const positional = args.filter((arg) => !arg.startsWith('--'))
  if (positional.length === 0) return { kind: 'bands' }
  if (positional.length === 1) return { kind: 'members', band: positional[0]! }
  return { kind: 'reset', band: positional[0]!, member: positional.slice(1).join(' '), makeAdmin: args.includes('--make-admin') }
}

export function findBand(bands: Band[], query: string): Band | string {
  const band = bands.find((b) => b.workspaceId === query) ?? bands.find((b) => b.workspaceName === query)
  return band ?? `Keine Band "${query}" auf diesem Stage-Server. Ohne Angabe aufrufen, um alle Bands zu sehen.`
}

/** The member to reset, or why not: unknown, ambiguous, or not an admin without --make-admin. */
export function findMember(members: Member[], query: string, makeAdmin: boolean): Member | string {
  const byId = members.find((m) => m.profileId === query)
  const byName = members.filter((m) => m.name.toLowerCase() === query.toLowerCase())
  const member = byId ?? (byName.length === 1 ? byName[0] : undefined)
  if (!member) {
    return byName.length > 1
      ? `Mehrere Mitglieder heißen "${query}" - bitte die ID angeben.`
      : `Kein Mitglied "${query}" in dieser Band. Mit nur der Band aufrufen, um alle zu sehen.`
  }
  if (!member.isAdmin && !makeAdmin) {
    return `${member.name} ist kein Admin - nur Admins haben eine PIN. Mit --make-admin wird ${member.name} Admin (nur nötig, wenn kein Admin mehr erreichbar ist).`
  }
  return member
}

async function main(): Promise<void> {
  const couch = serverCouchConfig()
  // Imported after the environment is set, like the server itself.
  const { listWorkspaces, workspaceDbName, resetAdminPin, setMemberAdmin } = await import('../workspaceProvisioning.js')
  const { allDocs, putDocWithRetry } = await import('../couch.js')
  type ProfileDoc = { _id: string; _rev?: string; id?: string; name?: string; stageRoles?: string[] }

  const request = parseArgs(process.argv.slice(2))
  const bands = await listWorkspaces(couch)
  if (request.kind === 'bands') {
    console.log('Bands auf diesem Stage-Server:')
    for (const band of bands) console.log(`  ${band.workspaceId}  ${band.workspaceName}`)
    console.log('\nMitglieder einer Band: npm run admin:reset -w core-backend -- <Band>')
    return
  }
  const band = findBand(bands, request.band)
  if (typeof band === 'string') throw new Error(band)
  const db = workspaceDbName(band.workspaceId)
  const profiles = await allDocs<ProfileDoc>(couch, db, { startkey: 'profiles:', endkey: 'profiles:￰' })
  const members: Member[] = profiles.map((p) => ({ profileId: p.id!, name: p.name ?? '?', isAdmin: (p.stageRoles ?? []).includes('admin') }))

  if (request.kind === 'members') {
    console.log(`Mitglieder von "${band.workspaceName}":`)
    for (const m of members) console.log(`  ${m.profileId}  ${m.name}${m.isAdmin ? '  (Admin)' : ''}`)
    if (!members.some((m) => m.isAdmin)) console.log('\nKein Admin mehr - einem Mitglied mit --make-admin eine PIN geben.')
    console.log('\nNeue PIN: npm run admin:reset -w core-backend -- <Band> <Mitglied>')
    return
  }

  const member = findMember(members, request.member, request.makeAdmin)
  if (typeof member === 'string') throw new Error(member)
  const credentials = await resetAdminPin(couch, band.workspaceId, member.profileId)
  if (!member.isAdmin) {
    await setMemberAdmin(couch, band.workspaceId, member.profileId, true)
    // The roster entry gets the admin role too, so the app shows it. Written with the server's
    // own CouchDB admin login (the roster validator lets `_admin` through) and re-read on a
    // conflict - a plain putDoc ignored a 409 and the roster silently stayed non-admin while this
    // still said "ist jetzt Admin" (#421 review).
    await putDocWithRetry<ProfileDoc>(couch, db, `profiles:${member.profileId}`, (profile) => {
      if (!profile) throw new Error(`Roster-Eintrag von ${member.name} fehlt - Rechte gesetzt, aber in der App nicht als Admin sichtbar.`)
      return { ...profile, stageRoles: [...new Set([...(profile.stageRoles ?? []), 'admin'])] }
    })
  }
  console.log(`${member.name} in "${band.workspaceName}"${member.isAdmin ? '' : ' ist jetzt Admin'}.`)
  console.log(`Neue PIN: ${credentials.password}`)
  console.log('In der App: Band beitreten, den Namen wählen, diese PIN eingeben - danach unter Einstellungen eine eigene PIN setzen.')
  console.log('Nach vielen Fehlversuchen ist das Konto ein paar Minuten gesperrt - dann warten oder: systemctl --user restart stageboard')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
