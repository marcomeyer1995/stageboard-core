import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { AccessCodeSchema, HostJoinInviteSchema } from 'shared-types'
import { createHostLogin, createSyncHost, createWriteGuard, HOST_ACCOUNTS_DOC_ID, type HostAccount, type SyncDatabase, type SyncRequest } from 'sync-host'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useAndroidHostStore } from '../store/useAndroidHostStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { getDeviceId } from '../lib/deviceId'
import { bandOfPath, answerHostRequest } from '../host/hostHttp'
import { createHostClock } from '../host/hostClock'
import { createHostStateMachine, type HostRole } from '../host/hostState'
import { leaseKey, signAccountRequest } from '../host/leaseAuth'
import { startCatchUp, type CatchUp } from '../host/catchUp'
import PouchDB from 'pouchdb-browser'
import { createAccountIssuer } from '../host/replicationAccount'
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
  setState: (options: { hostId: string; epoch: number; active: boolean; offsetMs: number }) => Promise<void>
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

const storedRole = () => {
  const role = readJson<HostRole>(ROLE_KEY)
  return role && Number.isInteger(role.epoch) && role.epoch >= 1 && typeof role.active === 'boolean' ? role : null
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

let running = false
let listener: PluginListenerHandle | null = null
let tick: ReturnType<typeof setInterval> | null = null
let sample: ReturnType<typeof setInterval> | null = null
let lastPushed = ''
let catchUp: CatchUp | null = null
let catchingUp = false

function pushState(machine: { state: () => { hostId: string; epoch: number; active: boolean } }, clock: { offsetMs: () => number | null }) {
  const state = machine.state()
  const key = `${state.hostId}|${state.epoch}|${state.active}|${Math.round(clock.offsetMs() ?? 0)}`
  if (key === lastPushed) return
  lastPushed = key
  void LocalHost.setState({ hostId: state.hostId, epoch: state.epoch, active: state.active, offsetMs: clock.offsetMs() ?? 0 }).catch(() => undefined)
}

function publish(machine: ReturnType<typeof createHostStateMachine>, url: string | null, error: string | null = null) {
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
  const clock = createHostClock({ now: () => Date.now() })
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
  const machine = createHostStateMachine({
    selfHostId: hostId,
    workspaceId,
    baseEpoch: 1,
    loadRole: storedRole,
    saveRole: (role) => localStorage.setItem(ROLE_KEY, JSON.stringify(role)),
    hosts: hostsNow,
    keys,
    get: (url) => getJson(url),
    post: (url, body) => postJson(url, body),
    self: () => (urlNow && startedFingerprint ? { url: urlNow, fingerprint: startedFingerprint } : null),
    accessCode: accessCodeNow,
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
  const login = createHostLogin({
    accounts: async (db) => {
      const store = db === dbName ? open(db) : null
      if (!store) return []
      const doc = (await store.get(HOST_ACCOUNTS_DOC_ID).catch(() => null)) as { accounts?: HostAccount[] } | null
      return [...(doc?.accounts ?? []), ...issuer.accounts()]
    },
  })

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

  await listener?.remove()
  listener = await LocalHost.addListener('request', (req) => {
    void (async () => {
      const body = req.text !== undefined ? (req.text === '' ? undefined : JSON.parse(req.text)) : { data: fromBase64(req.body ?? ''), contentType: req.contentType }
      const band = bandOfPath(req.path)
      // The native server asks this before it relays a live channel: a device of this band, or nothing.
      if (req.path.startsWith('/_host-login/') && band) {
        const ctx = await login(req.authorization, band.db)
        await LocalHost.respond({ id: req.id, status: ctx ? 200 : 401, contentType: 'application/json', text: JSON.stringify(ctx ? { ok: true } : { error: 'unauthorized' }) })
        return
      }
      const answer = await answerHostRequest(
        { method: req.method, path: req.path, query: Object.fromEntries(new URLSearchParams(req.query)), authorization: req.authorization, body },
        {
          hostId,
          port: PORT,
          address: startedAddress,
          certFingerprint: startedFingerprint,
          bandTime: () => clock.bandTime(),
          state: () => machine.state(),
          activeWorkspaceId: () => (machine.state().active ? workspaceId : null),
          lease: () => machine.lease(),
          acceptLease: async (raw) => {
            const result = await machine.acceptLease(raw)
            publish(machine, urlNow, null)
            pushState(machine, clock)
            return result
          },
          acceptInvite,
          verifyBandCode: async (band, code) => band === workspaceId && code === (await accessCodeNow()),
          // Only the host serves the band: a passive backup hands out no login to its data.
          issueAccount: async (raw) => (machine.state().active ? issuer.issue(raw) : null),
          sync: (ctx, request) => guard(ctx, request as SyncRequest, (r) => syncHost(r)),
          login,
        },
      )
      if (answer.binary) await LocalHost.respond({ id: req.id, status: answer.status, contentType: answer.binary.contentType, body: toBase64(answer.binary.data) })
      else await LocalHost.respond({ id: req.id, status: answer.status, contentType: 'application/json', text: JSON.stringify(answer.body ?? null) })
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
    pushState(machine, clock)
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
      await machine.takeoverCheck()
      void machine.sendOnce()
      await machine.handbackCheck()
      void syncCatchUp().catch(() => undefined)
      publish(machine, urlNow, null)
      pushState(machine, clock)
    })().catch(() => undefined)
  }, TICK_MS)

  sample = setInterval(() => {
    void (async () => {
      // Only the backup keeps the primary's clock, to serve its band time after a takeover.
      if (machine.state().active || machine.state().priority !== 2) return
      const primary = (hostsNow() ?? []).find((h) => h.priority === 1)
      if (!primary) return
      const t0 = Date.now()
      const answer = (await getJson(`${primary.url.replace(/\/+$/, '')}/time`).catch(() => null)) as { serverTime?: unknown } | null
      const t1 = Date.now()
      if (answer && typeof answer.serverTime === 'number') clock.add({ t0, t1, serverTime: answer.serverTime })
    })().catch(() => undefined)
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
  if (isNativeApp()) await LocalHost.stop().catch(() => undefined)
  useAndroidHostStore.getState().reset()
}

/** App start: the switch was on - bring the host back up with the epoch it had. */
export async function resumeAndroidHost(): Promise<void> {
  if (!androidHostSwitchOn()) return
  await startAndroidHost().catch(() => undefined)
}
