import {
  LogicalDeviceSchema,
  PluginInstallationSchema,
  hardwareKeyFor,
  matchDetectedHardware,
  type DetectedHardware,
  type DiscoveryCandidate,
  type DiscoverySession,
  type LogicalDevice,
  type PluginInstallation,
} from 'shared-types'
import { allDocs, type CouchConfig } from './couch.js'
import { workspaceDbName } from './workspaceProvisioning.js'

type Subscriber = (snapshot: DiscoverySession) => void

const LOGICAL_DEVICE_PREFIX = 'logical-devices:'
const PLUGIN_PREFIX = 'plugins:'

interface WorkspaceContext {
  plugins: PluginInstallation[]
  logicalDevices: LogicalDevice[]
}

const EMPTY_SESSION: DiscoverySession = { active: false, startedAt: null, startedBy: null, candidates: [], identifying: null }

const stateByWorkspace = new Map<string, DiscoverySession>()
const contextByWorkspace = new Map<string, WorkspaceContext>()
const subscribersByWorkspace = new Map<string, Set<Subscriber>>()
const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

/** How long to wait after the *last* candidate report before evaluating auto-assignment - not
 * instant, deliberately: tablets report independently over the network, so recomputing on every
 * single report would auto-assign a role to whichever candidate happens to arrive first, even
 * when a second, genuinely ambiguous candidate is a moment behind it. Debouncing here means
 * "unambiguous" actually means "still the only candidate once everyone's had a moment to
 * report", not "the only one reported so far". */
const CANDIDATE_SETTLE_MS = 2000
const settleTimers = new Map<string, ReturnType<typeof setTimeout>>()

function snapshotFor(workspaceId: string): DiscoverySession {
  return stateByWorkspace.get(workspaceId) ?? EMPTY_SESSION
}

export function getSnapshot(workspaceId: string): DiscoverySession {
  return snapshotFor(workspaceId)
}

/** For a participant that needs more than the broadcast snapshot carries - the Stage-Server's
 * own midiWatcher.ts resolves a winning candidate's real *output* port by the matched plugin's
 * `hardwareIds` namePattern (webMidiOutput.ts's doc comment has the full story on why), which
 * needs the plugin's full manifest, not just its id. */
export function getPlugin(workspaceId: string, pluginId: string): PluginInstallation | null {
  return contextByWorkspace.get(workspaceId)?.plugins.find((p) => p.id === pluginId) ?? null
}

function publish(workspaceId: string): void {
  const snapshot = snapshotFor(workspaceId)
  for (const subscriber of subscribersByWorkspace.get(workspaceId) ?? []) subscriber(snapshot)
}

export function subscribe(workspaceId: string, subscriber: Subscriber): () => void {
  const subscribers = subscribersByWorkspace.get(workspaceId) ?? new Set<Subscriber>()
  subscribers.add(subscriber)
  subscribersByWorkspace.set(workspaceId, subscribers)
  subscriber(snapshotFor(workspaceId))
  return () => subscribers.delete(subscriber)
}

async function readLogicalDevices(couch: CouchConfig, db: string): Promise<LogicalDevice[]> {
  const docs = await allDocs<unknown>(couch, db, { startkey: LOGICAL_DEVICE_PREFIX, endkey: `${LOGICAL_DEVICE_PREFIX}￰` })
  return docs.map((doc) => LogicalDeviceSchema.safeParse(doc)).filter((r) => r.success).map((r) => r.data)
}

async function readPlugins(couch: CouchConfig, db: string): Promise<PluginInstallation[]> {
  const docs = await allDocs<unknown>(couch, db, { startkey: PLUGIN_PREFIX, endkey: `${PLUGIN_PREFIX}￰` })
  return docs.map((doc) => PluginInstallationSchema.safeParse(doc)).filter((r) => r.success).map((r) => r.data)
}

/**
 * Starts (or restarts) a Discovery session for `workspaceId` - reads the *current* installed
 * plugins and Logical Devices once, up front, same "snapshot at start" spirit `createPluginSync`
 * already uses for its own reconcile pass. A session started mid-gig doesn't need to react to
 * someone editing Logical Devices while it's running; stop and start again for that.
 */
export async function start(couch: CouchConfig, workspaceId: string, startedBy: string | null): Promise<void> {
  const db = workspaceDbName(workspaceId)
  const [plugins, logicalDevices] = await Promise.all([readPlugins(couch, db), readLogicalDevices(couch, db)])
  contextByWorkspace.set(workspaceId, { plugins: plugins.filter((p) => p.enabled), logicalDevices })
  stateByWorkspace.set(workspaceId, { active: true, startedAt: Date.now(), startedBy, candidates: [], identifying: null })
  clearPendingTimeout(workspaceId)
  clearSettleTimer(workspaceId)
  publish(workspaceId)
}

function clearSettleTimer(workspaceId: string): void {
  const handle = settleTimers.get(workspaceId)
  if (handle) clearTimeout(handle)
  settleTimers.delete(workspaceId)
}

export function stop(workspaceId: string): void {
  clearSettleTimer(workspaceId)
  const current = snapshotFor(workspaceId)
  clearPendingTimeout(workspaceId)
  stateByWorkspace.set(workspaceId, { ...current, active: false, identifying: null })
  publish(workspaceId)
}

function clearPendingTimeout(workspaceId: string): void {
  const handle = pendingTimeouts.get(workspaceId)
  if (handle) clearTimeout(handle)
  pendingTimeouts.delete(workspaceId)
}

function isRoleOpen(session: DiscoverySession, logicalDeviceId: string): boolean {
  return !session.candidates.some((c) => c.assignedLogicalDeviceId === logicalDeviceId)
}

function candidatesForCapability(session: DiscoverySession, ctx: WorkspaceContext, capability: string): DiscoveryCandidate[] {
  const pluginIds = new Set(ctx.plugins.filter((p) => p.capabilities.includes(capability)).map((p) => p.id))
  return session.candidates.filter((c) => c.matchedPluginId && pluginIds.has(c.matchedPluginId) && c.status === 'unassigned')
}

/** How many still-open Logical Devices share `capability` - a single matching candidate is only
 * really unambiguous if there's also only one open role it could possibly belong to. Two open
 * "kemper-control" roles ("Marcos Kemper", "Hemme Kemper") with only one Kemper detected so far
 * is still ambiguous at the *role* level, even though `candidatesForCapability` sees exactly one
 * candidate - without this, whichever role happened to come first in `ctx.logicalDevices` would
 * silently win it, regardless of whose Kemper it actually is. */
function openRolesForCapability(session: DiscoverySession, ctx: WorkspaceContext, capability: string): LogicalDevice[] {
  return ctx.logicalDevices.filter((d) => d.capability === capability && isRoleOpen(session, d.id))
}

/** A candidate is only auto-assignable when its match came from a *specific* namePattern, not a
 * catch-all (generic-webmidi) - a catch-all matching "the only open Kemper-capability role" tells
 * us nothing about whether this port is actually a Kemper at all. */
function isSpecificMatch(plugin: PluginInstallation): boolean {
  return plugin.hardwareIds.some((id) => id.kind === 'webmidi' && !!id.namePattern) || plugin.hardwareIds.some((id) => id.kind === 'webusb')
}

/** Only flips status/assignment bookkeeping - writing the actual DeviceTransportConfig is each
 * winning participant's own job, reacting to seeing itself win in the broadcast snapshot (a
 * tablet's #106 `bind()`, or the Stage-Server's own midiWatcher.ts). Deliberately not done here:
 * resolving the real *output* port to write (as opposed to the *input* port a candidate was
 * detected on - see webMidiOutput.ts's doc comment for the full story on why those differ) needs
 * hardware-library access this module doesn't have and shouldn't need. */
function assignCandidate(candidate: DiscoveryCandidate, logicalDeviceId: string): void {
  candidate.status = 'assigned'
  candidate.assignedLogicalDeviceId = logicalDeviceId
}

/** Moves the sequential identification queue forward by one role (Design section, plan doc) -
 * called after every candidate report/assignment/timeout. Auto-assigns anything unambiguous
 * first; if nothing is currently `identifying`, starts the next role that has a trigger-capable
 * plugin among its open candidates, or flags remaining open roles `needs-manual` once nothing is
 * left to try. */
function recompute(workspaceId: string): void {
  const session = stateByWorkspace.get(workspaceId)
  const ctx = contextByWorkspace.get(workspaceId)
  if (!session || !session.active || !ctx) return

  for (const logicalDevice of ctx.logicalDevices) {
    if (!isRoleOpen(session, logicalDevice.id)) continue
    const candidates = candidatesForCapability(session, ctx, logicalDevice.capability)
    if (candidates.length !== 1) continue
    if (openRolesForCapability(session, ctx, logicalDevice.capability).length !== 1) continue
    const plugin = ctx.plugins.find((p) => p.id === candidates[0].matchedPluginId)
    if (plugin && isSpecificMatch(plugin)) assignCandidate(candidates[0], logicalDevice.id)
  }

  if (!session.identifying) advanceQueue(workspaceId, session, ctx)
  publish(workspaceId)
}

/**
 * Advances to the next role that still needs identifying, one at a time. A role with candidates
 * but no trigger-capable plugin among them can never resolve itself, so those specific
 * candidates (not the whole session's `unassigned` pool - a candidate irrelevant to any open
 * role has nowhere to go and rightly stays `unassigned`) get flagged `needs-manual` and the loop
 * moves on to the next role rather than getting stuck.
 */
function advanceQueue(workspaceId: string, session: DiscoverySession, ctx: WorkspaceContext): void {
  for (const logicalDevice of ctx.logicalDevices) {
    if (!isRoleOpen(session, logicalDevice.id)) continue
    const candidates = candidatesForCapability(session, ctx, logicalDevice.capability)
    if (candidates.length === 0) continue

    const plugin = ctx.plugins.find((p) => p.discoveryTrigger && candidates.some((c) => c.matchedPluginId === p.id))
    if (!plugin?.discoveryTrigger) {
      for (const candidate of candidates) candidate.status = 'needs-manual'
      continue
    }

    for (const candidate of candidates) {
      if (candidate.matchedPluginId === plugin.id) candidate.status = 'identifying'
    }
    const deadline = Date.now() + plugin.discoveryTrigger.timeoutMs
    session.identifying = {
      logicalDeviceId: logicalDevice.id,
      logicalDeviceName: logicalDevice.name,
      pluginId: plugin.id,
      instruction: plugin.discoveryTrigger.instruction,
      matchCcSequence: plugin.discoveryTrigger.matchCcSequence,
      deadline,
    }
    clearPendingTimeout(workspaceId)
    pendingTimeouts.set(
      workspaceId,
      setTimeout(() => onIdentifyTimeout(workspaceId, deadline), plugin.discoveryTrigger.timeoutMs),
    )
    return // one role at a time
  }
}

function onIdentifyTimeout(workspaceId: string, deadline: number): void {
  const session = stateByWorkspace.get(workspaceId)
  const ctx = contextByWorkspace.get(workspaceId)
  if (!session || !ctx || !session.identifying || session.identifying.deadline !== deadline) return // already resolved/changed

  for (const candidate of session.candidates) {
    if (candidate.matchedPluginId === session.identifying.pluginId && candidate.status === 'identifying') {
      candidate.status = 'needs-manual'
    }
  }
  session.identifying = null
  advanceQueue(workspaceId, session, ctx)
  publish(workspaceId)
}

/** A participant (tablet or the Stage-Server's own midiWatcher.ts) reports every port it
 * currently sees - both on session start (a full enumeration) and on every later connect event,
 * for as long as the session stays active. Matching against the workspace's installed plugins
 * happens here, once, on report - not re-run on every recompute. */
export function reportCandidate(workspaceId: string, reporterId: string, detected: DetectedHardware): void {
  const session = stateByWorkspace.get(workspaceId)
  const ctx = contextByWorkspace.get(workspaceId)
  if (!session?.active || !ctx) return

  const hardwareKey = hardwareKeyFor(detected)
  const match = matchDetectedHardware(ctx.plugins, detected)
  const name = detected.kind === 'webmidi' ? detected.name : ''
  const manufacturer = detected.kind === 'webmidi' ? detected.manufacturer : ''

  const existing = session.candidates.find((c) => c.reporterId === reporterId && c.hardwareKey === hardwareKey)
  if (existing) {
    existing.matchedPluginId = match?.id ?? null
  } else {
    session.candidates.push({
      reporterId,
      hardwareKey,
      name,
      manufacturer,
      matchedPluginId: match?.id ?? null,
      status: 'unassigned',
      assignedLogicalDeviceId: null,
    })
  }
  publish(workspaceId) // Let the admin UI show the new candidate right away, ahead of resolution.

  const pending = settleTimers.get(workspaceId)
  if (pending) clearTimeout(pending)
  settleTimers.set(
    workspaceId,
    setTimeout(() => {
      settleTimers.delete(workspaceId)
      recompute(workspaceId)
    }, CANDIDATE_SETTLE_MS),
  )
}

/** A participant reports that the musician performed the currently-identifying role's trigger
 * action on this specific candidate - first report wins the role. A report for anything other
 * than the currently-identifying plugin/an already-resolved candidate is silently ignored (a
 * stale/late report after the window already moved on). */
export function reportTriggered(workspaceId: string, reporterId: string, hardwareKey: string): void {
  const session = stateByWorkspace.get(workspaceId)
  const ctx = contextByWorkspace.get(workspaceId)
  if (!session?.active || !ctx || !session.identifying) return

  const candidate = session.candidates.find(
    (c) => c.reporterId === reporterId && c.hardwareKey === hardwareKey && c.status === 'identifying' && c.matchedPluginId === session.identifying?.pluginId,
  )
  if (!candidate) return

  clearPendingTimeout(workspaceId)
  const logicalDeviceId = session.identifying.logicalDeviceId
  assignCandidate(candidate, logicalDeviceId)
  // Any other candidate still `identifying` for this same role was a contender that lost.
  for (const other of session.candidates) {
    if (other !== candidate && other.matchedPluginId === session.identifying?.pluginId && other.status === 'identifying') {
      other.status = 'unassigned'
    }
  }
  session.identifying = null
  advanceQueue(workspaceId, session, ctx)
  publish(workspaceId)
}

/** A human, looking at the candidate list (DeviceSetupWizard.tsx's Step 3), directly confirming
 * "this candidate is this role" - for a plugin with no `discoveryTrigger` (identical-signature
 * hardware whose actual identity check needs something the CC-sequence flow can't express, e.g.
 * NUX MG-30's SysEx handshake), the automatic (`recompute`) and physical-gesture (`reportTriggered`)
 * paths can never resolve on their own, no matter how obviously right the live MIDI feed already
 * looks to the person watching it - this is their way to say so. Silently a no-op for a stale
 * click (the role got taken, the candidate vanished, the session moved on) - same reasoning as
 * `reportTriggered`'s own late-report handling; the wizard's own re-render off the session
 * snapshot is what surfaces that, not an error thrown back here.
 */
export function assign(workspaceId: string, reporterId: string, hardwareKey: string, logicalDeviceId: string): void {
  const session = stateByWorkspace.get(workspaceId)
  const ctx = contextByWorkspace.get(workspaceId)
  if (!session?.active || !ctx) return
  if (!isRoleOpen(session, logicalDeviceId)) return

  const candidate = session.candidates.find((c) => c.reporterId === reporterId && c.hardwareKey === hardwareKey)
  if (!candidate) return

  clearPendingTimeout(workspaceId)
  assignCandidate(candidate, logicalDeviceId)
  if (session.identifying?.logicalDeviceId === logicalDeviceId) {
    // The role this candidate just claimed was the one the sequential queue was mid-asking about
    // - any other candidate still `identifying` for that same plugin was a contender that lost.
    for (const other of session.candidates) {
      if (other !== candidate && other.matchedPluginId === session.identifying?.pluginId && other.status === 'identifying') {
        other.status = 'unassigned'
      }
    }
    session.identifying = null
  }
  advanceQueue(workspaceId, session, ctx)
  publish(workspaceId)
}

/** Test-only: this module's state is shared across the whole process by design - tests need a
 * way to reset it between runs (presenceStore.ts's identical convention). */
export function __resetDiscoverySessionStoreForTests(): void {
  stateByWorkspace.clear()
  contextByWorkspace.clear()
  subscribersByWorkspace.clear()
  for (const handle of pendingTimeouts.values()) clearTimeout(handle)
  pendingTimeouts.clear()
  for (const handle of settleTimers.values()) clearTimeout(handle)
  settleTimers.clear()
}
