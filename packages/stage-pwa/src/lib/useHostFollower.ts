import { useEffect } from 'react'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useStageServerStore } from '../store/useStageServerStore'
import { configLog } from './configDebug'
import { followHostOnce, probeHostEpoch } from './hostFollow'
import { useHostEpochStore } from './hostEpoch'
import { isNativeApp } from './native'
import { getStageServerUrl, overrideForTypedUrl } from './stageServer'

/** Often enough that a takeover (5-8 s of silence, docs/25 §6e) is followed within seconds, rarely
 * enough that the second host sees next to no traffic - it is a passive backup. */
const CHECK_INTERVAL_MS = 5_000

/**
 * Mounted once in App.tsx (host backup, #916). While the band lists two hosts, asks the one this
 * device is not paired with for its epoch and moves to it when it is ahead (hostFollow.ts). The sync
 * and the clock follow a changed server address by themselves (#900). Does nothing in the native
 * app: it pins one certificate per host, and switching there needs `ServerTrustPlugin` to accept the
 * listed fingerprint first.
 */
export function useHostFollower(): void {
  const hosts = useBandSettingsStore((state) => state.settings.hosts)
  useEffect(() => {
    if (!hosts || hosts.length < 2 || isNativeApp()) return
    const check = () => {
      const currentUrl = getStageServerUrl()
      if (!currentUrl) return
      void followHostOnce({
        hosts,
        currentUrl,
        currentEpoch: useHostEpochStore.getState().currentEpoch,
        probe: probeHostEpoch,
        switchTo: (host) => {
          configLog('hostFollower', 'switching to', host.hostId, host.url)
          useStageServerStore.getState().setUrl(overrideForTypedUrl(host.url))
        },
      })
    }
    const interval = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [hosts])
}
