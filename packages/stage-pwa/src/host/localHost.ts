import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { AccessCodeSchema, HostJoinInviteSchema } from 'shared-types'
import { BAND_SETTINGS_DOC_ID, createBandAccounts, createBandAccountStore, createBandCatalog, createHostChannels, createHostDeviceInfo, createHostPresence, listedHostIds, createBandJoin, createBandMembers, createPinThrottle, createReplicationAccountIssuer, leaseKey, signAccountRequest, startCatchUp, type BandAccounts, type BandJoin, type BandMembers, type CatchUp, createSyncHost, createWriteGuard, type SyncDatabase, type SyncRequest } from 'sync-host'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useAndroidHostStore } from '../store/useAndroidHostStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { getDeviceId } from '../lib/deviceId'
import { answerHostRequest, loginCheckOf, type AppHostDeps } from '../host/hostHttp'
import { createTabletHost, type TabletHost } from '../host/tabletHost'
import PouchDB from 'pouchdb-browser'
import { getAudioStorageBackend } from '../lib/audioStorageBackend'
import { createHostAudio } from './hostAudio'
import { isNativeApp, pinListedHosts } from '../lib/native'
import { getWorkspaceDb, localDbName, LOCAL_DB_OPTIONS } from '../lib/workspaceDb'
import { bandIdsFromDatabases } from './bandScan'
import { createServing } from './serving'
import { createTabletCapabilities, deviceFromBrowser } from './tabletCapabilities'
import { createTabletBandStore, type BandDatabase } from './tabletBandStore'

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
const SENT_AT_KEY = 'stageboard-android-account-requests'
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
  /** The address the connection came from (LocalHostPlugin.java). */
  remoteAddress?: string
  text?: string
  body?: string
}

interface LocalHostPlugin {
  start: (options: { port: number }) => Promise<{ port: number; address: string | null; certFingerprint: string }>
  stop: () => Promise<void>
  /** The clock answer and the live channels are answered natively - they need the epoch and whether
   * this host serves the band, never the WebView. */
  setState: (options: { hostId: string; epoch: number; active: boolean; offsetMs: number; origins: string[]; servedBands: string[] }) => Promise<void>
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

/** Bands deleted on this device - a deleted band is never founded again (#364), even without a server. */
const DELETED_KEY = 'stageboard-deleted-bands'
const readDeletedBands = (): string[] => {
  const ids = readJson<unknown>(DELETED_KEY)
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
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
/** One native publish per served band (the presence store keys by band). */
const presenceSubscriptions = new Map<string, () => void>()
let catchingUp = false
/** The bands this tablet founded: its native server relays their live channels whatever the lease says (#962). */
let servedBands: string[] = []
/** Tells the native server at once - a band founded a moment ago must not wait for the next tick. */
const setServedBands = (bands: Iterable<string>) => {
  servedBands = [...bands].sort()
  lastPushed = ''
}

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
  const key = `${state.hostId}|${state.epoch}|${state.active}|${Math.round(machine.clockOffsetMs())}|${origins.join(',')}|${servedBands.join(',')}`
  if (key === lastPushed) return
  lastPushed = key
  void LocalHost.setState({ hostId: state.hostId, epoch: state.epoch, active: state.active, offsetMs: machine.clockOffsetMs(), origins, servedBands }).catch(() => undefined)
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
  // A tablet needs no band of its own to be a host (#962): it then serves the clock, its capabilities and the band life
  // cycle - a phone founds the first band on it - and every band it founded. `workspaceId` is '' while it holds none.
  const activeBand = workspaceIdNow()
  const hasBand = activeBand !== null
  const workspaceId = activeBand ?? ''
  localStorage.setItem(SWITCH_KEY, 'on')
  localStorage.removeItem(INVITE_KEY)
  await pinHosts()
  const hostId = getDeviceId()
  let keysFor = hasBand ? storedCode(workspaceId) : null
  const keys = async () => {
    // The band's code lives in its own database (`workspace:access`), which a host holds - the same
    // source the Host uses (hostLeaseAuth.ts). The invite (#945) is only the fallback.
    if (!keysFor && hasBand) {
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
    workspaceId: () => (hasBand ? workspaceId : null),
    readHosts: async () => hostsNow() ?? null,
    readAccessCode: accessCodeNow,
    get: (url) => getJson(url).catch(() => null),
    post: (url, body) => postJson(url, body).catch(() => null),
    selfUrl: () => urlNow ?? undefined,
    selfFingerprint: () => startedFingerprint || null,
    catchUp: () => catchUp?.status() ?? null,
    songRunning: async () => {
      if (!hasBand) return false
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
  // What the tablet knows about each device (the Device Ledger, #958). It cannot ping, so reachable and name stay unknown.
  const deviceInfo = createHostDeviceInfo({ now: () => machine.bandTime() })

  // The bands this tablet holds in IndexedDB: what the browser lists (PouchDB prefixes its databases with `_pouch_`),
  // plus the app's own list - a band just founded is in the store before its database shows up.
  const localBands = new Set<string>(hasBand ? [workspaceId] : [])
  const localBandIds = async (): Promise<string[]> => {
    const databases = (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases
    if (typeof databases === 'function') {
      try {
        for (const id of bandIdsFromDatabases((await databases.call(indexedDB)).map((database) => database.name))) localBands.add(id)
      } catch {
        // No database listing here - the app's own list still knows its bands.
      }
    }
    for (const workspace of useWorkspaceStore.getState().workspaces) localBands.add(workspace.id)
    return [...localBands]
  }

  // One handle per band: the active band's is the app's own (its live views follow what the host writes), every other
  // band's a handle of its own. Opening a name the device does not hold would create an empty database, so `open`
  // (the sync side) only answers names this tablet knows.
  const handles = new Map<string, PouchDB.Database>()
  const dbFor = (band: string): PouchDB.Database => {
    let handle = handles.get(band)
    if (!handle) {
      handle = isActiveBand(band) ? (getWorkspaceDb(band) as unknown as PouchDB.Database) : new PouchDB(localDbName(band), LOCAL_DB_OPTIONS)
      handles.set(band, handle)
    }
    return handle
  }
  const bandOfDbName = (name: string): string | null => (name.startsWith('stageboard-') ? name.slice('stageboard-'.length) : null)
  const open = (name: string) => {
    const band = bandOfDbName(name)
    return band !== null && localBands.has(band) ? (dbFor(band) as unknown as SyncDatabase) : null
  }

  // The bands this tablet founded itself (its id in the access doc): it serves them even while another band is the
  // active one. A band it only joined is served only while the lease makes it the host.
  const founded = new Set<string>()
  const isActiveBand = (band: string): boolean => hasBand && band === workspaceId
  const servesBand = (band: string): boolean => isActiveBand(band) || founded.has(band)
  const serving = createServing({ founded: () => founded, activeBand: () => (hasBand ? workspaceId : null), leaseActive: () => machine.state().active })

  // Presence (flash, Ready Check, heartbeat) and the Device Ledger are one store for all bands - they key by band - and
  // the native server publishes each served band's channel, so its devices see the Ready Check and flash messages.
  const subscribePresence = (band: string) => {
    if (presenceSubscriptions.has(band)) return
    presenceSubscriptions.set(
      band,
      presence.subscribe(band, (snapshot) => {
        void LocalHost.publish({ channel: `${band}/presence`, text: JSON.stringify(snapshot) }).catch(() => undefined)
      }),
    )
  }

  /** The standing code of a band this host serves, read from its own data (the active band's is cached for the lease). */
  const accessCodeOf = async (band: string): Promise<string | null> => {
    if (isActiveBand(band)) {
      await keys()
      return keysFor
    }
    const doc = await dbFor(band).get('workspace:access').catch(() => null)
    const parsed = AccessCodeSchema.safeParse(doc)
    return parsed.success ? parsed.data.code : null
  }
  const profileOf = (band: string) => async (profileId: string) =>
    (await dbFor(band).get(`profiles:${profileId}`).catch(() => null)) as { stageRoles?: string[] } | null

  // One accounts/join/members set per band, built on first use - the same code the laptop runs.
  const accountsPerBand = new Map<string, BandAccounts>()
  const accountsFor = (band: string): BandAccounts => {
    let accounts = accountsPerBand.get(band)
    if (!accounts) {
      accounts = createBandAccounts({
        store: createBandAccountStore(dbFor(band) as never),
        workspaceId: band,
        // The devices the band lists as hosts have the role `host`: they write the band's accounts with their own sync.
        hostDevices: async () => listedHostIds(await dbFor(band).get(BAND_SETTINGS_DOC_ID).catch(() => null)),
      })
      accountsPerBand.set(band, accounts)
    }
    return accounts
  }
  const joinPerBand = new Map<string, BandJoin>()
  const joinBandFor = (band: string): BandJoin => {
    let join = joinPerBand.get(band)
    if (!join) {
      join = createBandJoin({ accounts: accountsFor(band), throttle: createPinThrottle(), workspaceId: band, accessCode: () => accessCodeOf(band), profile: profileOf(band) })
      joinPerBand.set(band, join)
    }
    return join
  }
  const membersPerBand = new Map<string, BandMembers>()
  const membersFor = (band: string): BandMembers => {
    let members = membersPerBand.get(band)
    if (!members) {
      members = createBandMembers({
        accounts: accountsFor(band),
        join: joinBandFor(band),
        workspaceId: band,
        loginThrottle: createPinThrottle(),
        profile: profileOf(band),
        adminProfileIds: async () => {
          const rows = await dbFor(band).allDocs({ startkey: 'profiles:', endkey: 'profiles:￰', include_docs: true })
          return rows.rows.flatMap((row) => {
            const doc = row.doc as { id?: string; stageRoles?: string[] } | undefined
            return doc?.id && (doc.stageRoles ?? []).includes('admin') ? [doc.id] : []
          })
        },
      })
      membersPerBand.set(band, members)
    }
    return members
  }
  const login = async (authorization: string | undefined, db: string) => {
    const band = bandOfDbName(db)
    return band !== null && servesBand(band) ? accountsFor(band).login(authorization) : null
  }

  // The band life cycle (#962) over the databases this app holds: founding, listing, deleting, renaming, the access
  // code, the master mode and the Device Ledger's block/remove - the rules are sync-host's catalog.
  const bandStore = createTabletBandStore({
    hostId,
    bandIds: async () => localBandIds(),
    open: (band) => dbFor(band) as unknown as BandDatabase,
    copy: async (band, docs) => {
      // A copy of everything before the database goes (#362): a backup database the device can restore from.
      const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '')
      const backup = new PouchDB(`stageboard-deleted-${band}-${stamp}`)
      await backup.bulkDocs(
        docs.map((doc) => {
          const copy = { ...doc }
          delete copy._rev
          return copy
        }),
      )
      await backup.close()
    },
    deleted: {
      is: (band) => readDeletedBands().includes(band),
      mark: (band) => {
        const ids = readDeletedBands()
        if (!ids.includes(band)) localStorage.setItem(DELETED_KEY, JSON.stringify([...ids, band]))
      },
    },
  })
  const bands = createBandCatalog({
    store: {
      ...bandStore,
      create: async (band, name, founder) => {
        const credentials = await bandStore.create(band, name, founder)
        localBands.add(band)
        founded.add(band)
        setServedBands(founded)
        subscribePresence(band)
        return credentials
      },
      remove: async (band) => {
        await bandStore.remove(band)
        localBands.delete(band)
        founded.delete(band)
        setServedBands(founded)
        handles.get(band)?.close?.()
        handles.delete(band)
      },
    },
    // Only a request from this very device (the app's own loopback) founds without an admin proof.
    isSelfRequest: (address) => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1',
  })

  // The live channels, the same module the laptop runs (#962): what a device sends into one is answered by the shared
  // routes; Discovery reads the band's plugins and logical devices from the tablet's own database.
  const channels = createHostChannels({
    presence,
    readBandDocs: async (band, prefix) => {
      const rows = await dbFor(band).allDocs({ startkey: prefix, endkey: `${prefix}\uffff`, include_docs: true })
      return rows.rows.flatMap((row) => (row.doc ? [row.doc as unknown] : []))
    },
  })

  const syncHost = createSyncHost({ open })
  const guard = createWriteGuard({ open, security: async () => ({ admins: { roles: ['admin'] }, members: { roles: ['member', 'admin'] } }) })
  // The login the returned primary copies what was written while the tablet was host with (#947): the same issuer the
  // Host runs, a login document of the band like every other.
  const issuer = createReplicationAccountIssuer({
    selfHostId: hostId,
    workspaceId: () => (hasBand ? workspaceId : null),
    readHosts: async () => hostsNow() ?? null,
    readAccessCode: accessCodeNow,
    mint: (_band, askingHostId) => accountsFor(workspaceId).provisionDevice('host', askingHostId, false),
    // Kept across a restart: a recorded request must not become good again.
    sentAt: {
      get: (askingHostId) => readJson<Record<string, number>>(SENT_AT_KEY)?.[askingHostId],
      set: (askingHostId, at) => localStorage.setItem(SENT_AT_KEY, JSON.stringify({ ...readJson<Record<string, number>>(SENT_AT_KEY), [askingHostId]: at })),
    },
  })
  if (hasBand) subscribePresence(workspaceId)


  const acceptInvite = async (raw: unknown) => {
    const invite = HostJoinInviteSchema.safeParse(raw)
    if (!invite.success) return { ok: false as const, status: 400, message: invite.error.issues[0]?.message ?? 'Invalid invite' }
    const { workspaceId: invitedBand, accessCode, primaryUrl, targetHostId, fingerprint, sentAt } = invite.data
    if (targetHostId !== hostId) return { ok: false as const, status: 400, message: 'This invite is for another host' }
    if (invitedBand !== workspaceIdNow()) return { ok: false as const, status: 409, message: 'This tablet holds another band' }
    const last = readJson<{ at: number }>(INVITE_KEY)?.at ?? -1
    if (sentAt <= last || sentAt > Date.now() + 60_000) return { ok: false as const, status: 409, message: 'This invite is old or was already used' }
    // The code arrives from the primary, so the primary is asked whether it is really this band's -
    // the same proof the Host's host join uses (#945). Already known and unchanged: trust it.
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
    activeWorkspaceId: () => (hasBand ? workspaceId : null),
    acceptInvite,
    audio: hostAudio,
    joinBand: (band) => (servesBand(band) ? joinBandFor(band) : null),
    members: (band) => (servesBand(band) ? membersFor(band) : null),
    presence,
    deviceInfo,
    channels,
    capabilities: () => createTabletCapabilities(deviceFromBrowser()),
    serving,
    // The tablet serves every band it founded, and the band the lease makes it host of; a flash message needs a
    // device of it (the same login as the database).
    servesBand,
    isBandDevice: async (band, authorization) => servesBand(band) && (await login(authorization, localDbName(band))) !== null,
    // The band as a joining device sees it - read from the band's own data, like every device holds it.
    band: {
      accessCode: async (band) => {
        if (!servesBand(band)) return null
        const doc = (await dbFor(band).get('workspace:access').catch(() => null)) as { code?: unknown; name?: unknown } | null
        return typeof doc?.code === 'string' && typeof doc.name === 'string' && doc.name !== '' ? { code: doc.code, name: doc.name } : null
      },
      profileDocs: async (band) => {
        if (!servesBand(band)) return []
        const rows = await dbFor(band).allDocs({ startkey: 'profiles:', endkey: 'profiles:￰', include_docs: true })
        return rows.rows.flatMap((row) => (row.doc ? [row.doc as unknown as Record<string, unknown>] : []))
      },
    },
    bands,
    // Only the host serves the band: a passive backup hands out no login to its data.
    issueAccount: async (raw) => (machine.state().active ? issuer.issue(raw) : null),
    sync: (ctx, request) => guard(ctx, request as SyncRequest, (r) => syncHost(r)),
    login,
  }

  // Which local bands this tablet founded itself - the access doc names this host. They are served from now on, even
  // while another band is the active one.
  for (const band of await localBandIds()) {
    const doc = (await dbFor(band).get('workspace:access').catch(() => null)) as { hostId?: unknown } | null
    if (doc?.hostId === hostId) {
      founded.add(band)
      subscribePresence(band)
    }
  }
  setServedBands(founded)

  await listener?.remove()
  listener = await LocalHost.addListener('request', (req) => {
    void (async () => {
      const body = req.text !== undefined ? (req.text === '' ? undefined : JSON.parse(req.text)) : { data: fromBase64(req.body ?? ''), contentType: req.contentType }
      // The native server asks this before it relays a live channel: a device of this band, or nothing.
      const checkDb = loginCheckOf(req.path)
      if (checkDb !== null) {
        const ctx = await login(req.authorization, checkDb)
        await LocalHost.respond({ id: req.id, status: ctx ? 200 : 401, contentType: 'application/json', text: JSON.stringify(ctx ? { ok: true } : { error: 'unauthorized' }) })
        return
      }
      const answer = await answerHostRequest({ method: req.method, path: req.path, query: Object.fromEntries(new URLSearchParams(req.query)), authorization: req.authorization, ...(req.remoteAddress ? { remoteAddress: req.remoteAddress } : {}), body }, hostDeps)
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
  for (const unsubscribe of presenceSubscriptions.values()) unsubscribe()
  presenceSubscriptions.clear()
  servedBands = []
  if (isNativeApp()) await LocalHost.stop().catch(() => undefined)
  useAndroidHostStore.getState().reset()
}

/** App start: the switch was on - bring the host back up with the epoch it had. */
export async function resumeAndroidHost(): Promise<void> {
  if (!androidHostSwitchOn()) return
  await startAndroidHost().catch(() => undefined)
}
