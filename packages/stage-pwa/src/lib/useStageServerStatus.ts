import { useEffect, useRef, useState } from 'react'
import type { WorkspaceSummary } from 'shared-types'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { getStageServerUrl } from './stageServer'
import { stageServerDebugEnabled, stageServerLog } from './stageServerDebug'
import {
  clearLastKnownStageServer,
  getLastKnownStageServer,
  updateLastKnownStageServer,
  type StageServerSnapshot,
} from './stageServerStatusCache'

export type StageServerReachability = 'loading' | 'reachable' | 'unreachable'

/** How long the hook waits with no answer at all before it flags the status as `slow`. Not a
 * failure and nothing is aborted: an answer that arrives later still just shows up. */
export const STATUS_SLOW_AFTER_MS = 8000

const EMPTY: StageServerSnapshot = { lanIp: null, hostname: null, workspaces: null, activeWorkspaceId: null }

const round = (ms: number) => Math.round(ms)

/** The browser's own idea of the connection (Chrome/Android only) - a slow link explains slow
 * answers without anything being wrong in the app. */
function describeNetwork(): string {
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number } }).connection
  if (!connection) return 'network: no info from this browser'
  return `network: ${connection.effectiveType ?? '?'} down ${connection.downlink ?? '?'}Mbps rtt ${connection.rtt ?? '?'}ms`
}

/** Watches for long tasks (main thread blocked >50ms) until the returned function is called,
 * which reports them - the "is the tablet just busy" half of the question. Only with the debug
 * flag on, and only where the browser supports it. */
function startLongTaskProbe(): () => string {
  if (!stageServerDebugEnabled() || typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    return () => ''
  }
  const durations: number[] = []
  const observer = new PerformanceObserver((list) => list.getEntries().forEach((entry) => durations.push(entry.duration)))
  observer.observe({ entryTypes: ['longtask'] })
  return () => {
    observer.takeRecords().forEach((entry) => durations.push(entry.duration))
    observer.disconnect()
    if (durations.length === 0) return 'long tasks: none'
    return `long tasks: ${durations.length}, longest ${round(Math.max(...durations))}ms, total ${round(durations.reduce((a, b) => a + b, 0))}ms`
  }
}

/** Runs one status request, and - only with the `sb:debug:stageServer` flag on - logs where its
 * time went, using the browser's resource timing entry for that URL (see stageServerDebug.ts). */
async function timed<T>(name: string, path: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now()
  const result = await run()
  if (stageServerDebugEnabled()) {
    const end = performance.now()
    const base = getStageServerUrl()
    const entry = base
      ? (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((e) => e.name === `${base}${path}`).pop()
      : undefined
    stageServerLog(
      name,
      result === null ? 'FAILED' : 'ok',
      `${round(end - start)}ms total`,
      ...(entry
        ? [
            `blocked ${round(entry.requestStart - entry.startTime)}ms`,
            `server ${round(entry.responseStart - entry.requestStart)}ms`,
            `transfer ${round(entry.responseEnd - entry.responseStart)}ms`,
            `js-continuation ${round(end - entry.responseEnd)}ms`,
            entry.nextHopProtocol,
          ]
        : ['(no resource timing entry)']),
    )
  }
  return result
}

/**
 * Everything the UI needs to know about this specific physical Stage-Server: whether it's
 * reachable at all, its own address/name, every band it hosts, and which one's hardware
 * (plugin sync, Discovery Mode's MIDI watcher) it currently serves. Shared between
 * WorkspaceHardwareSettings.tsx (the switch control), BandManagementView.tsx's "Hardware auf
 * diesem Server" indicator (deliberately shown there too - that tab already has its own,
 * unrelated "which workspace is active *on this device*" concept, and the two are easy to
 * conflate), and DeviceLedgerView.tsx's "this is the Stage-Server itself" row.
 *
 * Built so a slow answer never leaves the screen on a bare "Lade…" (found live: 30+ seconds in
 * Settings, with the server itself answering in milliseconds - its answers were stuck behind the
 * app's own audio downloads on the same connection, audioStorageManager.ts):
 * - The last answer this page got (stageServerStatusCache.ts) is shown instantly, `refreshing`
 *   marking that it's being re-checked.
 * - The three requests are applied one by one as they arrive, not held until the slowest is in.
 * - With no answer at all after STATUS_SLOW_AFTER_MS, `slow` is set - and that is all: a slow
 *   answer is not an unreachable server (an earlier version said "nicht erreichbar" here while the
 *   server was fine and merely congested), and nothing is aborted, so the answer still shows up.
 *   `'unreachable'` is only for when the requests actually *fail*.
 *
 * `status` is `'reachable'` as soon as *any* request got an answer - a server that's up but has
 * never had a workspace activated on it is still reachable, just with `activeWorkspaceId: null`.
 * It's `'unreachable'` only when nothing answered (which also covers "no Stage-Server configured
 * at all" - there's nothing meaningfully different to show for that case here).
 *
 * `reload()` resolves once all three requests have settled.
 */
export function useStageServerStatus() {
  const listWorkspaces = useWorkspaceStore((state) => state.listWorkspaces)
  const fetchActiveWorkspaceHardware = useWorkspaceStore((state) => state.fetchActiveWorkspaceHardware)
  const fetchServerInfo = useWorkspaceStore((state) => state.fetchServerInfo)

  const cached = getLastKnownStageServer()
  const [snapshot, setSnapshot] = useState<StageServerSnapshot>(cached ?? EMPTY)
  const [status, setStatus] = useState<StageServerReachability>(cached ? 'reachable' : 'loading')
  const [refreshing, setRefreshing] = useState(false)
  const [slow, setSlow] = useState(false)
  const runRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const unmountedRef = useRef(false)

  async function reload(): Promise<void> {
    const run = ++runRef.current
    const current = () => run === runRef.current && !unmountedRef.current
    const startedAt = performance.now()
    let answered = 0

    stageServerLog('reload start', cached ? '(showing last known status meanwhile)' : '(nothing cached)')
    if (stageServerDebugEnabled()) {
      stageServerLog(describeNetwork())
      // How long a zero-delay timer really takes: a busy main thread shows up here right away.
      const scheduledAt = performance.now()
      setTimeout(() => stageServerLog(`event-loop lag ${round(performance.now() - scheduledAt)}ms`), 0)
    }
    const finishLongTaskProbe = startLongTaskProbe()
    setRefreshing(true)
    setSlow(false)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (current() && answered === 0) {
        stageServerLog(`nothing answered after ${STATUS_SLOW_AFTER_MS}ms - flagged as slow (still waiting, not failed)`)
        setSlow(true)
      }
    }, STATUS_SLOW_AFTER_MS)

    function applyAnswer(patch: Partial<StageServerSnapshot>) {
      if (!current()) return
      answered += 1
      setSnapshot(updateLastKnownStageServer(patch))
      setStatus('reachable')
      setSlow(false)
    }

    await Promise.all([
      timed('listWorkspaces', '/workspaces', listWorkspaces).then((list) => {
        if (list) applyAnswer({ workspaces: list })
      }),
      timed('fetchActiveWorkspaceHardware', '/server/active-workspace', fetchActiveWorkspaceHardware).then((result) => {
        if (result) applyAnswer({ activeWorkspaceId: result.activeWorkspaceId })
      }),
      timed('fetchServerInfo', '/server-info', fetchServerInfo).then((info) => {
        if (info) applyAnswer({ lanIp: info.lanIp, hostname: info.hostname })
      }),
    ])

    clearTimeout(timerRef.current)
    stageServerLog(`reload done in ${Math.round(performance.now() - startedAt)}ms`, `${answered}/3 answered`, finishLongTaskProbe())
    if (!current()) return
    setRefreshing(false)
    setSlow(false)
    if (answered === 0) {
      clearLastKnownStageServer()
      setStatus('unreachable')
    }
  }

  useEffect(() => {
    unmountedRef.current = false
    void reload()
    return () => {
      unmountedRef.current = true
      clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeWorkspaceName =
    snapshot.workspaces?.find((w: WorkspaceSummary) => w.workspaceId === snapshot.activeWorkspaceId)?.workspaceName ?? null

  return {
    status,
    refreshing,
    slow,
    lanIp: snapshot.lanIp,
    hostname: snapshot.hostname,
    workspaces: snapshot.workspaces,
    activeWorkspaceId: snapshot.activeWorkspaceId,
    activeWorkspaceName,
    reload,
  }
}
