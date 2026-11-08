import { allDocs, getDoc, listDbs, putDocWithRetry, waitForChange, type CouchConfig, type CouchDoc } from './couch.js'

/**
 * Accounts on a host without the Stage-Server (docs/25 §6b, Marco 2026-11-07: "C"): every band
 * database carries the login keys of its devices, so any device can become the host - also when the
 * one before it fails mid-gig - and recognise every tablet of the band. Only device logins (random,
 * 24 bytes - `deviceUsername`'s `~` names), never an anchor: an admin's anchor holds the 4-digit
 * PIN, which offline would be guessed in seconds. Written only by the Stage-Server (`_admin`, see
 * the roster validator); it follows `_users`, so every way an account changes - pairing, a role,
 * a removed member, the command-line tools, CouchDB upgrading a hash - reaches it.
 */
export const HOST_ACCOUNTS_DOC_ID = 'host-accounts'

/** One device login as a host checks it - CouchDB's own PBKDF2 fields, nothing else of the user. */
export interface HostAccount {
  name: string
  roles: string[]
  password_scheme: string
  pbkdf2_prf?: string
  iterations: number
  salt: string
  derived_key: string
}

export interface HostAccountsDoc extends CouchDoc {
  accounts: HostAccount[]
}

type UserDoc = CouchDoc & Partial<HostAccount> & { name?: string; roles?: string[] }

const USER_PREFIX = 'org.couchdb.user:'

/** The band's device logins out of `_users` documents - sorted, so an unchanged list writes nothing. */
export function hostAccountsOf(bandDb: string, users: UserDoc[]): HostAccount[] {
  return users
    .filter((u): u is UserDoc & { name: string; salt: string; derived_key: string } =>
      typeof u.name === 'string' && u.name.startsWith(`${bandDb}-`) && u.name.includes('~') && !!u.salt && !!u.derived_key)
    .map((u) => ({
      name: u.name,
      roles: u.roles ?? [],
      password_scheme: u.password_scheme ?? 'pbkdf2',
      ...(u.pbkdf2_prf ? { pbkdf2_prf: u.pbkdf2_prf } : {}),
      iterations: u.iterations ?? 10,
      salt: u.salt,
      derived_key: u.derived_key,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Brings one band's `host-accounts` up to date. True when it changed. */
export async function publishHostAccounts(config: CouchConfig, bandDb: string): Promise<boolean> {
  const users = await allDocs<UserDoc>(config, '_users', { startkey: `${USER_PREFIX}${bandDb}-`, endkey: `${USER_PREFIX}${bandDb}-￰` })
  const accounts = hostAccountsOf(bandDb, users)
  const current = await getDoc<HostAccountsDoc>(config, bandDb, HOST_ACCOUNTS_DOC_ID)
  if (current && JSON.stringify(current.accounts) === JSON.stringify(accounts)) return false
  await putDocWithRetry<HostAccountsDoc>(config, bandDb, HOST_ACCOUNTS_DOC_ID, (existing) => ({ ...(existing ?? { _id: HOST_ACCOUNTS_DOC_ID }), accounts }))
  return true
}

/** The band databases whose accounts a set of `_users` ids touches. */
export function bandsOfUserIds(bandDbs: string[], userIds: string[]): string[] {
  const names = userIds.filter((id) => id.startsWith(USER_PREFIX)).map((id) => id.slice(USER_PREFIX.length))
  return bandDbs.filter((db) => names.some((name) => name.startsWith(`${db}-`)))
}

async function bandDbs(config: CouchConfig): Promise<string[]> {
  return (await listDbs(config)).filter((db) => db.startsWith('stageboard-'))
}

/**
 * Publishes every band once, then follows `_users` and republishes the bands an account change
 * touches. A failure is logged and retried after a pause - never stops the server.
 */
export function watchHostAccounts(
  config: CouchConfig,
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void },
  options: { pollMs?: number; retryMs?: number } = {},
): { stop: () => void } {
  let stopped = false
  const pollMs = options.pollMs ?? 60_000
  const retryMs = options.retryMs ?? 30_000

  const publish = async (dbs: string[]) => {
    const changed: string[] = []
    for (const db of dbs) {
      // One band failing must not keep the others on old accounts.
      try {
        if (await publishHostAccounts(config, db)) changed.push(db)
      } catch (err) {
        log.error({ err, db }, 'Could not publish the host accounts of this band')
      }
    }
    if (changed.length > 0) log.info({ databases: changed }, 'Host accounts published')
  }

  void (async () => {
    let since = 'now'
    let first = true
    while (!stopped) {
      try {
        if (first) {
          // From "now" on first, so no change between the full publish and the first poll is lost.
          since = (await waitForChange(config, '_users', 'now', 0)).lastSeq
          await publish(await bandDbs(config))
          first = false
        }
        const next = await waitForChange(config, '_users', since, pollMs)
        since = next.lastSeq
        if (next.changed) await publish(bandsOfUserIds(await bandDbs(config), next.ids))
      } catch (err) {
        if (stopped) return
        log.error({ err }, 'Host accounts: following the accounts failed - retrying')
        await new Promise((resolve) => setTimeout(resolve, retryMs))
      }
    }
  })()

  return { stop: () => void (stopped = true) }
}
