import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { AccessCodeSchema, HostJoinInviteSchema } from 'shared-types'
import { createBandAccounts, createBandAccountStore, createBandJoin, createBandMembers, createPinThrottle, createHostLogin, createHostPresence, leaseKey, signAccountRequest, startCatchUp, type CatchUp, createSyncHost, createWriteGuard, HOST_ACCOUNTS_DOC_ID, type HostAccount, type SyncDatabase, type SyncRequest } from 'sync-host'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useAndroidHostStore } from '../store/useAndroidHostStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { getDeviceId } from '../lib/deviceId'
import { answerHostRequest, loginCheckOf, type AppHostDeps } from '../host/hostHttp'
import { createTabletHost, type TabletHost } from '../host/tabletHost'
import PouchDB from 'pouchdb-browser'
import { createAccountIssuer } from '../host/replicationAccount'
import { getAudioStorageBackend } from '../lib/audioStorageBackend'
import { createHostAudio } from './hostAudio'
import { isNativeApp, pinListedHosts } from '../lib/native'
import { getWorkspaceDb, localDbName } from '../lib/workspaceDb'

/**
 * The tablet as the band's host (host backup, #947, docs/25 §6g): a switch starts a small native
 * web server (LocalHostPlugin.java); the app answers it over the band database it already holds.
 * Passive at first - it answers only who it is, the lease and its status - and takes over when the
 * primary has been silent for 5 s and does not answer directly. Everything about *serving* a band
 * (sync, live channels, audio) follows the epoch the app pushes to the native server.
 */

/** The switch and the state that must survive a restart. */
const SWITCH_KEY = 'stageboard-android-host'
const ROLE_KEY = 'stageboard-android-host-role'
const CODE_KEY = 'stageboard-android-host-code'
const ACCOUNTS_KEY = 'stageboard-android-host-accounts'
const INVITE_KEY = 'stageboard-android-host-invite-at'
const PORT = 8443
const TICK_MS = 1_000
const SAMPLE_MS = 2_000

interface HostRequest {
  id: string
  method: string
  path: string
  query: string
  contentType: string
  authorization?: string
  text?: string
  body?: string
}

interface LocalHostPlugin {
  start: (options: { port: number }) => Promise<{ port: number; address: string | null; certFingerprint: string }>
  stop: () => Promise<void>
  /** The clock answer and the live channels are answered natively - they need the epoch and whether
   * this host serves the band, never the WebView. */
  setState: (options: { hostId: string; epoch: number; active: boolean; offsetMs: number; origins: string[] }) => Promise<void>
  /** Hands the native server the latest snapshot of a live channel; every open stream gets it, a new one gets it on connecting. */
  publish: (options: { channel: string; text: string }) => Promise<void>
  respond: (options: { id: string; status: number; contentType: string; text?: string; body?: string }) => Promise<void>
  addListener: (event: 'request', handler: (req: HostRequest) => void) => Promise<PluginListenerHandle>
}

const LocalHost = registerPlugin<LocalHostPlugin>('LocalHost')

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}

const storedRole = (): { epoch: number; active: boolean } => {
  const role = readJson<{ epoch: number; active: boolean }>(ROLE_KEY)
  return role && Number.isInteger(role.epoch) && role.epoch >= 0 && typeof role.active === 'boolean' ? role : { epoch: 0, active: false }
}

interface StoredCode {
  workspaceId: string
  accessCode: string
}
const storedCode = (workspaceId: string) => {
  const stored = readJson<StoredCode>(CODE_KEY)
  return stored?.workspaceId === workspaceId ? stored.accessCode : null
}

const workspaceIdNow = () => useWorkspaceStore.getState().activeWorkspaceId || null
const hostsNow = () => useBandSettingsStore.getState().settings.hosts

/** A host we talk to from the app: the native shell only trusts a host whose certificate it pinned. */
async function pinHosts() {
  const hosts = hostsNow()
  if (hosts) await pinListedHosts(hosts)
}

/** GET JSON from another host; the shell only talks to a host whose certificate it pinned (`pinHosts`). */
async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) })
  return response.ok ? response.json() : null
}

/** POST JSON to another host: its answer, or null when it answered with an error. */
async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) })
  return response.ok ? response.json() : null
}

/** The tracks this tablet holds, as the host serves them (#781, #954): its own playback cache - see hostAudio.ts. The
 * revision of a track comes from the band's song list, which the tablet holds as every device does. */
const hostAudio = createHostAudio({
  backend: getAudioStorageBackend(),
  revisionOf: async (variantId, trackId) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId
    if (!workspaceId) return undefined
    const doc = (await getWorkspaceDb(workspaceId).get(`song-variants:${variantId}`).catch(() => null)) as { tracks?: { id?: string; fileRev?: number }[] } | null
    return doc?.tracks?.find((track) => track.id === trackId)?.fileRev
  },
})

let running = false
let listener: PluginListenerHandle | null = null
let tick: ReturnType<typeof setInterval> | null = null
let sample: ReturnType<typeof setInterval> | null = null
let lastPushed = ''
let catchUp: CatchUp | null = null
let unsubscribePresence: (() => void) | null = null
let catchingUp = false

function pushState(machine: TabletHost) {
  const state = machine.state()
  // Pages of the band's hosts may read this host from a browser (CORS) - the app itself always may.
  const origins = (hostsNow() ?? []).flatMap((h) => {
    try {
      return [new URL(h.url).origin]
    } catch {
      return []
    }
  })
  const key = `${state.hostId}|${state.epoch}|${state.active}|${Math.round(machine.clockOffsetMs())}|${origins.join(',')}`
  if (key === lastPushed) return
  lastPushed = key
  void LocalHost.setState({ hostId: state.hostId, epoch: state.epoch, active: state.active, offsetMs: machine.clockOffsetMs(), origins }).catch(() => undefined)
}

function publish(machine: TabletHost, url: string | null, error: string | null = null) {
  const state = machine.state()
  useAndroidHostStore.getState().set({ running: true, url, hostId: state.hostId, epoch: state.epoch, active: state.active, outdated: state.outdated, priority: state.priority, lease: machine.lease(), error })
}

/** Is the switch on (and is this the native app)? Read by the UI and at app start. */
export function androidHostSwitchOn(): boolean {
  return isNativeApp() && localStorage.getItem(SWITCH_KEY) === 'on'
}

/**
 * Starts the tablet as a host, passive first. Without a band there is nothing to be the host of -
 * the switch reports that instead of starting a server that could never serve anything.
 */
export async function startAndroidHost(): Promise<void> {
  if (!isNativeApp()) return
  if (running) return
  const workspaceId = workspaceIdNow()
  if (!workspaceId) {
    useAndroidHostStore.getState().set({ running: false, error: 'no-band' })
    return
  }
  localStorage.setItem(SWITCH_KEY, 'on')
  localStorage.removeItem(INVITE_KEY)
  await pinHosts()
  const hostId = getDeviceId()
  let keysFor = storedCode(workspaceId)
  const keys = async () => {
    // The band's code lives in its own database (`workspace:access`), which a host holds - the same
    // source the Stage-Server uses (hostLeaseAuth.ts). The invite (#945) is only the fallback.
    if (!keysFor) {
      const doc = await getWorkspaceDb(workspaceId).get('workspace:access').catch(() => null)
      const parsed = AccessCodeSchema.safeParse(doc)
      if (parsed.success) {
        keysFor = parsed.data.code
        localStorage.setItem(CODE_KEY, JSON.stringify({ workspaceId, accessCode: keysFor }))
      }
    }
    return keysFor ? [await leaseKey(keysFor, workspaceId)] : []
  }
  const accessCodeNow = async () => {
    await keys()
    return keysFor
  }
  // The band database as this app already holds it - never another band's, and none made up by a request.
  const dbName = localDbName(workspaceId)
  const machine = createTabletHost({
    selfHostId: hostId,
    baseEpoch: 1,
    roleStore: { load: storedRole, save: (role) => localStorage.setItem(ROLE_KEY, JSON.stringify(role)) },
    workspaceId: () => workspaceId,
    readHosts: async () => hostsNow() ?? null,
    readAccessCode: accessCodeNow,
    get: (url) => getJson(url).catch(() => null),
    post: (url, body) => postJson(url, body).catch(() => null),
    selfUrl: () => urlNow ?? undefined,
    selfFingerprint: () => startedFingerprint || null,
    catchUp: () => catchUp?.status() ?? null,
    songRunning: async () => {
      // A band that never played has no show-state yet: not running. A database that cannot be read throws: cannot tell.
      const doc = (await getWorkspaceDb(workspaceId).get('show-state').catch((err: { status?: number }) => {
        if (err.status === 404) return null
        throw err
      })) as { playbackStatus?: string } | null
      return doc?.playbackStatus === 'playing'
    },
    now: () => Date.now(),
  })

  // Who is online and who is master - what a device needs to be confirmed as master; the native server relays it.
  const presence = createHostPresence({ now: () => machine.bandTime() })
  unsubscribePresence?.()
  unsubscribePresence = presence.subscribe((snapshot) => {
    void LocalHost.publish({ channel: `${workspaceId}/presence`, text: JSON.stringify(snapshot) }).catch(() => undefined)
  })
  const open = (name: string) => (name === dbName ? (getWorkspaceDb(workspaceId) as unknown as SyncDatabase) : null)
  const syncHost = createSyncHost({ open })
  const guard = createWriteGuard({ open, security: async () => ({ admins: { roles: ['admin'] }, members: { roles: ['member', 'admin'] } }) })
  // Logins handed to the returned primary so it can copy what was written while the tablet was host (#947).
  const issuer = createAccountIssuer({
    selfHostId: hostId,
    workspaceId,
    hosts: hostsNow,
    key: async () => (await keys())[0] ?? null,
    load: () => readJson(ACCOUNTS_KEY),
    save: (state) => localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(state)),
  })
  // The band's own accounts (#960): logins and PIN verifiers as documents of the band database, the same code the
  // Stage-Server runs. The older logins (`host-accounts`, written by a Stage-Server on CouchDB) still work next to them.
  const accounts = createBandAccounts({ store: createBandAccountStore(getWorkspaceDb(workspaceId) as never), workspaceId })
  const joinBand = createBandJoin({
    accounts,
    throttle: createPinThrottle(),
    workspaceId,
    accessCode: accessCodeNow,
    profile: async (profileId) => (await getWorkspaceDb(workspaceId).get(`profiles:${profileId}`).catch(() => null)) as { stageRoles?: string[] } | null,
  })
  const members = createBandMembers({
    accounts,
    join: joinBand,
    workspaceId,
    loginThrottle: createPinThrottle(),
    profile: async (profileId) => (await getWorkspaceDb(workspaceId).get(`profiles:${profileId}`).catch(() => null)) as { stageRoles?: string[] } | null,
    adminProfileIds: async () => {
      const rows = await getWorkspaceDb(workspaceId).allDocs({ startkey: 'profiles:', endkey: 'profiles:\ufff0', include_docs: true })
      return rows.rows.flatMap((row) => {
        const doc = row.doc as { id?: string; stageRoles?: string[] } | undefined
        return doc?.id && (doc.stageRoles ?? []).includes('admin') ? [doc.id] : []
      })
    },
  })
  const listedLogin = createHostLogin({
    accounts: async (db) => {
      const store = db === dbName ? open(db) : null
      if (!store) return []
      const doc = (await store.get(HOST_ACCOUNTS_DOC_ID).catch(() => null)) as { accounts?: HostAccount[] } | null
      return [...(doc?.accounts ?? []), ...issuer.accounts()]
    },
  })
  const login: typeof listedLogin = async (authorization, db) => (db === dbName ? await accounts.login(authorization) : null) ?? listedLogin(authorization, db)

  const acceptInvite = async (raw: unknown) => {
    const invite = HostJoinInviteSchema.safeParse(raw)
    if (!invite.success) return { ok: false as const, status: 400, message: invite.error.issues[0]?.message ?? 'Invalid invite' }
    const { workspaceId: invitedBand, accessCode, primaryUrl, targetHostId, fingerprint, sentAt } = invite.data
    if (targetHostId !== hostId) return { ok: false as const, status: 400, message: 'This invite is for another host' }
    if (invitedBand !== workspaceIdNow()) return { ok: false as const, status: 409, message: 'This tablet holds another band' }
    const last = readJson<{ at: number }>(INVITE_KEY)?.at ?? -1
    if (sentAt <= last || sentAt > Date.now() + 60_000) return { ok: false as const, status: 409, message: 'This invite is old or was already used' }
    // The code arrives from the primary, so the primary is asked whether it is really this band's -
    // the same proof the Stage-Server's host join uses (#945). Already known and unchanged: trust it.
    if (storedCode(workspaceId) !== accessCode) {
      try {
        if (fingerprint) await pinListedHosts([{ url: primaryUrl, certFingerprint: fingerprint }])
        const response = await fetch(`${primaryUrl.replace(/\/+$/, '')}/workspaces/${encodeURIComponent(workspaceId)}/roster`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: accessCode }),
          signal: AbortSignal.timeout(5_000),
        })
        if (!response.ok) return { ok: false as const, status: 403, message: 'The primary did not accept the band code' }
      } catch {
        return { ok: false as const, status: 502, message: 'The primary does not confirm the band' }
      }
      localStorage.setItem(CODE_KEY, JSON.stringify({ workspaceId, accessCode }))
      keysFor = accessCode
    }
    localStorage.setItem(INVITE_KEY, JSON.stringify({ at: sentAt }))
    return { ok: true as const }
  }

  let startedAddress: string | null = null
  let startedFingerprint = ''
  let urlNow: string | null = null

  // What this tablet answers: the routes every host shares (sync-host) plus its own (hostHttp.ts). Built once - the shared
  // route table is cached on it.
  const hostDeps: AppHostDeps = {
    hostId,
    port: PORT,
    get address() {
      return startedAddress
    },
    get certFingerprint() {
      return startedFingerprint
    },
    state: () => machine.state(),
    lease: {
      bandTime: () => machine.bandTime(),
      epoch: () => machine.service.epoch(),
      isBandHost: () => machine.state().active,
      isActive: () => machine.service.isActive(),
      outdated: () => machine.service.outdated(),
      status: () => machine.lease(),
      clockOffsetMs: () => machine.service.clockOffsetMs(),
      receive: async (raw) => {
        const result = await machine.service.receive(raw)
        publish(machine, urlNow, null)
        pushState(machine)
        return result
      },
    },
    // The band this tablet holds - a passive backup holds it too (the primary must not invite it again).
    activeWorkspaceId: () => workspaceId,
    acceptInvite,
    audio: hostAudio,
    joinBand: (band) => (band === workspaceId ? joinBand : null),
    members: (band) => (band === workspaceId ? members : null),
    presence: {
      report: (band, report) => band === workspaceId && presence.report(report),
      heartbeat: (band, deviceId) => band === workspaceId && presence.heartbeat({ deviceId }),
    },
    verifyBandCode: async (band, code) => band === workspaceId && code === (await accessCodeNow()),
    // Only the host serves the band: a passive backup hands out no login to its data.
    issueAccount: async (raw) => (machine.state().active ? issuer.issue(raw) : null),
    sync: (ctx, request) => guard(ctx, request as SyncRequest, (r) => syncHost(r)),
    login,
  }

  await listener?.remove()
  listener = await LocalHost.addListener('request', (req) => {
    void (async () => {
      const body = req.text !== undefined ? (req.text === '' ? undefined : JSON.parse(req.text)) : { data: fromBase64(req.body ?? ''), contentType: req.contentType }
      // The native server asks this before it relays a live channel: a device of this band, or nothing.
      const checkDb = loginCheckOf(req.path)
      if (checkDb !== null) {
        const ctx = checkDb === dbName ? await login(req.authorization, checkDb) : null
        await LocalHost.respond({ id: req.id, status: ctx ? 200 : 401, contentType: 'application/json', text: JSON.stringify(ctx ? { ok: true } : { error: 'unauthorized' }) })
        return
      }
      const answer = await answerHostRequest({ method: req.method, path: req.path, query: Object.fromEntries(new URLSearchParams(req.query)), authorization: req.authorization, body }, hostDeps)
      if (answer.binary) await LocalHost.respond({ id: req.id, status: answer.status, contentType: answer.binary.contentType, body: toBase64(answer.binary.data) })
      else await LocalHost.respond({ id: req.id, status: answer.status, contentType: 'application/json', text: answer.status === 204 ? '' : JSON.stringify(answer.body ?? null) })
    })().catch((err: unknown) => {
      void LocalHost.respond({ id: req.id, status: 500, contentType: 'application/json', text: JSON.stringify({ error: String(err) }) })
    })
  })

  const started = await LocalHost.start({ port: PORT })
  startedAddress = started.address
  startedFingerprint = started.certFingerprint
  urlNow = `https://${started.address ?? '127.0.0.1'}:${started.port}`
  running = true
  const refresh = () => {
    publish(machine, urlNow, null)
    pushState(machine)
  }
  refresh()

  /** While out of date, the tablet pulls the backup's data into its own database (#947); once handed back it stops. */
  const syncCatchUp = async () => {
    if (!machine.state().outdated) {
      catchUp?.stop()
      catchUp = null
      return
    }
    if (catchUp || catchingUp) return
    catchingUp = true
    try {
      const other = (hostsNow() ?? []).find((h) => h.hostId !== hostId)
      const key = (await keys())[0]
      if (!other || !key) return
      const base = other.url.replace(/\/+$/, '')
      const account = (await postJson(`${base}/host/replication-account`, await signAccountRequest({ hostId, sentAt: Date.now() }, key)).catch(() => null)) as { username?: string; password?: string } | null
      if (!account?.username || !account.password) return
      const remote = new PouchDB(`${base}/db/${dbName}`, { auth: { username: account.username, password: account.password } }) as unknown as PouchDB.Database
      catchUp = startCatchUp({ remote, local: getWorkspaceDb(workspaceId) as unknown as PouchDB.Database })
    } finally {
      catchingUp = false
    }
  }

  tick = setInterval(() => {
    void (async () => {
      await pinHosts()
      await machine.service.takeoverCheck()
      void machine.service.sendOnce()
      await machine.service.handbackCheck()
      void syncCatchUp().catch(() => undefined)
      publish(machine, urlNow, null)
      pushState(machine)
    })().catch(() => undefined)
  }, TICK_MS)

  // Only the backup keeps the primary's clock, to serve its band time after a takeover - the shared service knows when.
  sample = setInterval(() => {
    void machine.service.sampleOnce().catch(() => undefined)
  }, SAMPLE_MS)
}

/** The switch off: the server stops listening, the epoch is kept for the next start. */
export async function stopAndroidHost(): Promise<void> {
  localStorage.setItem(SWITCH_KEY, 'off')
  running = false
  if (tick !== null) clearInterval(tick)
  if (sample !== null) clearInterval(sample)
  tick = null
  sample = null
  lastPushed = ''
  await listener?.remove().catch(() => undefined)
  listener = null
  catchUp?.stop()
  catchUp = null
  unsubscribePresence?.()
  unsubscribePresence = null
  if (isNativeApp()) await LocalHost.stop().catch(() => undefined)
  useAndroidHostStore.getState().reset()
}

/** App start: the switch was on - bring the host back up with the epoch it had. */
export async function resumeAndroidHost(): Promise<void> {
  if (!androidHostSwitchOn()) return
  await startAndroidHost().catch(() => undefined)
}
