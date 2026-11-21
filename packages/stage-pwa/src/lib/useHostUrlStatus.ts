import { useEffect, useRef, useState } from 'react'
import type { WorkspaceSummary } from 'shared-types'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import {
  clearLastKnownHost,
  getLastKnownHost,
  updateLastKnownHost,
  type HostUrlSnapshot,
} from './hostUrlStatusCache'
import { isNativeApp } from './native'
import { getHostUrl } from './hostUrl'
import { useHostUrlStore } from '../store/useHostUrlStore'

/** `unpaired`: the native app (#348) hasn't been paired with any Host yet - nothing to ask. */
export type HostUrlReachability = 'loading' | 'reachable' | 'unreachable' | 'unpaired'

/** How long the hook waits with no answer at all before it flags the status as `slow`. Not a
 * failure and nothing is aborted: an answer that arrives later still just shows up. */
export const STATUS_SLOW_AFTER_MS = 8000

const EMPTY: HostUrlSnapshot = { lanIp: null, hostname: null, workspaces: null, activeWorkspaceId: null }

/**
 * Everything the UI needs to know about this specific physical Host: whether it's
 * reachable at all, its own address/name, every band it hosts, and which one's hardware
 * (plugin sync, Discovery Mode's MIDI watcher) it currently serves. Shared between
 * WorkspaceHardwareSettings.tsx (the switch control), BandManagementView.tsx's "Hardware auf
 * diesem Server" indicator (deliberately shown there too - that tab already has its own,
 * unrelated "which workspace is active *on this device*" concept, and the two are easy to
 * conflate), and DeviceLedgerView.tsx's "this is the Host itself" row.
 *
 * Built so a slow answer never leaves the screen on a bare "Lade…" (found live: 30+ seconds in
 * Settings, with the host itself answering in milliseconds - its answers were stuck behind the
 * app's own audio downloads on the same connection, audioStorageManager.ts):
 * - The last answer this page got (hostUrlStatusCache.ts) is shown instantly, `refreshing`
 *   marking that it's being re-checked.
 * - The three requests are applied one by one as they arrive, not held until the slowest is in.
 * - With no answer at all after STATUS_SLOW_AFTER_MS, `slow` is set - and that is all: a slow
 *   answer is not an unreachable host (an earlier version said "nicht erreichbar" here while the
 *   server was fine and merely congested), and nothing is aborted, so the answer still shows up.
 *   `'unreachable'` is only for when the requests actually *fail*.
 *
 * `status` is `'reachable'` as soon as *any* request got an answer - a host that's up but has
 * never had a workspace activated on it is still reachable, just with `activeWorkspaceId: null`.
 * It's `'unreachable'` only when nothing answered (which also covers "no Host configured
 * at all" - there's nothing meaningfully different to show for that case here).
 *
 * `reload()` resolves once all three requests have settled.
 */
export function useHostUrlStatus() {
  const listWorkspaces = useWorkspaceStore((state) => state.listWorkspaces)
  const fetchActiveWorkspaceHardware = useWorkspaceStore((state) => state.fetchActiveWorkspaceHardware)
  const fetchHostInfo = useWorkspaceStore((state) => state.fetchHostInfo)
  // Re-check when the app gets paired (or re-paired) with a host.
  const serverUrl = useHostUrlStore((state) => state.url)

  const cached = getLastKnownHost()
  const [snapshot, setSnapshot] = useState<HostUrlSnapshot>(cached ?? EMPTY)
  const [status, setStatus] = useState<HostUrlReachability>(cached ? 'reachable' : 'loading')
  const [refreshing, setRefreshing] = useState(false)
  const [slow, setSlow] = useState(false)
  const runRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const unmountedRef = useRef(false)

  async function reload(): Promise<void> {
    const run = ++runRef.current
    if (isNativeApp() && !getHostUrl()) {
      // The unpaired native app: no server to ask yet (a browser always has the address it was loaded from).
      clearTimeout(timerRef.current)
      setRefreshing(false)
      setSlow(false)
      setStatus('unpaired')
      return
    }
    const current = () => run === runRef.current && !unmountedRef.current
    let answered = 0

    setRefreshing(true)
    setSlow(false)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (current() && answered === 0) {
        setSlow(true)
      }
    }, STATUS_SLOW_AFTER_MS)

    function applyAnswer(patch: Partial<HostUrlSnapshot>) {
      if (!current()) return
      answered += 1
      setSnapshot(updateLastKnownHost(patch))
      setStatus('reachable')
      setSlow(false)
    }

    await Promise.all([
      listWorkspaces().then((list) => {
        if (list) applyAnswer({ workspaces: list })
      }),
      fetchActiveWorkspaceHardware().then((result) => {
        if (result) applyAnswer({ activeWorkspaceId: result.activeWorkspaceId })
      }),
      fetchHostInfo().then((info) => {
        if (info) applyAnswer({ lanIp: info.lanIp, hostname: info.hostname })
      }),
    ])

    clearTimeout(timerRef.current)
    if (!current()) return
    setRefreshing(false)
    setSlow(false)
    if (answered === 0) {
      clearLastKnownHost()
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
  }, [serverUrl])

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
