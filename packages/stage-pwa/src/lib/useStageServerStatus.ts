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

/** How long the hook shows "loading" with nothing at all to show before it says "nicht
 * erreichbar". Nothing is aborted: an answer that arrives later still flips it back. */
export const STATUS_TIMEOUT_MS = 8000

const EMPTY: StageServerSnapshot = { lanIp: null, hostname: null, workspaces: null, activeWorkspaceId: null }

const round = (ms: number) => Math.round(ms)

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
 * Settings, with the server itself answering in milliseconds):
 * - The last answer this page got (stageServerStatusCache.ts) is shown instantly, `refreshing`
 *   marking that it's being re-checked.
 * - The three requests are applied one by one as they arrive, not held until the slowest is in.
 * - With nothing at all after STATUS_TIMEOUT_MS the status becomes `'unreachable'` - but nothing
 *   is aborted, so a late answer still turns it back into `'reachable'`.
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
  const runRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const unmountedRef = useRef(false)

  async function reload(): Promise<void> {
    const run = ++runRef.current
    const current = () => run === runRef.current && !unmountedRef.current
    const startedAt = performance.now()
    let answered = 0

    stageServerLog('reload start', cached ? '(showing last known status meanwhile)' : '(nothing cached)')
    setRefreshing(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (current() && answered === 0) {
        stageServerLog(`nothing answered after ${STATUS_TIMEOUT_MS}ms - showing "unreachable"`)
        clearLastKnownStageServer()
        setStatus('unreachable')
      }
    }, STATUS_TIMEOUT_MS)

    function applyAnswer(patch: Partial<StageServerSnapshot>) {
      if (!current()) return
      answered += 1
      setSnapshot(updateLastKnownStageServer(patch))
      setStatus('reachable')
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
    stageServerLog(`reload done in ${Math.round(performance.now() - startedAt)}ms`, `${answered}/3 answered`)
    if (!current()) return
    setRefreshing(false)
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
    lanIp: snapshot.lanIp,
    hostname: snapshot.hostname,
    workspaces: snapshot.workspaces,
    activeWorkspaceId: snapshot.activeWorkspaceId,
    activeWorkspaceName,
    reload,
  }
}
