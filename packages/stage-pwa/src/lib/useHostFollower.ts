import { useEffect } from 'react'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useStageServerStore } from '../store/useStageServerStore'
import { configLog } from './configDebug'
import { followHostOnce, probeHostEpoch } from './hostFollow'
import { useHostEpochStore } from './hostEpoch'
import { hostOfUrl, isNativeApp, pairWithServer, pinListedHosts } from './native'
import { getStageServerUrl, overrideForTypedUrl } from './stageServer'

/** Often enough that a takeover (5-8 s of silence, docs/25 §6e) is followed within seconds, rarely
 * enough that the second host sees next to no traffic - it is a passive backup. */
const CHECK_INTERVAL_MS = 5_000

/**
 * Mounted once in App.tsx (host backup, #916). While the band lists two hosts, asks the one this
 * device is not paired with for its epoch and moves to it when it is ahead (hostFollow.ts). The sync
 * and the clock follow a changed server address by themselves (#900). In the native app the shell pins
 * one certificate per host, so the listed fingerprints are pinned first (`pinListedHosts`) and the move
 * goes through `pairWithServer`; a host listed without a fingerprint is never moved to there.
 */
export function useHostFollower(): void {
  const hosts = useBandSettingsStore((state) => state.settings.hosts)
  useEffect(() => {
    if (!hosts || hosts.length < 2) return
    const native = isNativeApp()
    // The shell only talks to a host whose certificate it has pinned. The fingerprints the admin listed
    // count as trusted (Marco, 2026-11-17), so the listed hosts are pinned here, before the first probe.
    const pinned = native ? pinListedHosts(hosts) : Promise.resolve(null)
    const check = async () => {
      const currentUrl = getStageServerUrl()
      if (!currentUrl) return
      await pinned
      await followHostOnce({
        hosts,
        currentUrl,
        currentEpoch: useHostEpochStore.getState().currentEpoch,
        currentActive: useHostEpochStore.getState().currentActive,
        probe: probeHostEpoch,
        switchTo: (host) => {
          configLog('hostFollower', 'switching to', host.hostId, host.url)
          if (!native) {
            useStageServerStore.getState().setUrl(overrideForTypedUrl(host.url))
          } else if (host.certFingerprint) {
            // Pins the certificate and makes it the server address, as pairing does.
            void pairWithServer(hostOfUrl(host.url), host.certFingerprint)
          }
          // A host with no fingerprint cannot be trusted by the shell: stay.
        },
      })
    }
    const interval = setInterval(() => void check(), CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [hosts])
}
